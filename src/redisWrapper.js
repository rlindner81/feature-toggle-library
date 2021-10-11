"use strict";

const redis = require("redis");
const VError = require("verror");
const { promisify } = require("util");
const { Logger } = require("./logger");
const { isOnCF, cfServiceCredentials } = require("./env");

const COMPONENT_NAME = "/RedisWrapper";
const VERROR_CLUSTER_NAME = "RedisWrapperError";
const logger = Logger(COMPONENT_NAME);

const MODE = Object.freeze({
  RAW: "raw",
  OBJECT: "object",
});

let redisIsOnCF = isOnCF;
let client = null;
let subscriberClient = null;
let messageHandlers = {};

const _reset = () => {
  redisIsOnCF = isOnCF;
  client = null;
  subscriberClient = null;
  messageHandlers = {};
};
const _setRedisIsOnCF = (value) => (redisIsOnCF = value);
const _getClient = () => client;
const _getSubscriberClient = () => subscriberClient;
const _getMessageHandlers = () => messageHandlers;
const _hasMessageHandlers = (channel) => Object.prototype.hasOwnProperty.call(messageHandlers, channel);

const _logErrorOnEvent = (err, ...messages) =>
  redisIsOnCF
    ? logger.error(
        messages.length
          ? new VError({ name: VERROR_CLUSTER_NAME, cause: err }, ...messages)
          : new VError({ name: VERROR_CLUSTER_NAME, cause: err })
      )
    : logger.warning("error caught during event: %s", err.message);

const _onMessage = async (incomingChannel, message) => {
  if (!_hasMessageHandlers(incomingChannel)) {
    return;
  }
  const handlers = messageHandlers[incomingChannel];
  await Promise.all(
    handlers.map(async (handler) => {
      try {
        await handler(message);
      } catch (err) {
        _logErrorOnEvent(err, "error during message handler %O", {
          handler: handler.name,
          channel: incomingChannel,
        });
      }
    })
  );
};

/**
 * Lazily create a new redis client unless the variable that is passed in already is a redis client. Client creation
 * transparently handles both the Cloud Foundry "redis-cache" service (hyperscaler option) and a local redis-server.
 *
 * @param input  variable ensuring we don't create a redundant client
 * @returns {RedisClient}
 * @private
 */
const _createClientBase = (input) => {
  if (!input) {
    if (redisIsOnCF) {
      try {
        const credentials = cfServiceCredentials({ label: "redis-cache" });
        // NOTE: settings the user explicitly to empty resolves auth problems, see
        // https://github.com/go-redis/redis/issues/1343
        const url = credentials.uri.replace(/(?<=rediss:\/\/)[\w-]+?(?=:)/, "");
        input = redis.createClient(url, { no_ready_check: true });
      } catch (err) {
        throw new VError(
          { name: VERROR_CLUSTER_NAME, cause: err },
          "error during create client with redis-cache service"
        );
      }
    } else {
      input = redis.createClient();
    }
  }
  return input;
};

/**
 * Lazily create a regular client to be used
 * - for getting/setting values
 * - as message publisher
 *
 * Only one publisher is necessary for any number of channels.
 *
 * @returns {RedisClient}
 * @private
 */
const _createClient = () => {
  client = _createClientBase(client);

  client.on("error", (err) => {
    _logErrorOnEvent(err, "error event on redis client");
    client && client.quit();
    client = null;
  });
  client.getAsync = promisify(client.get).bind(client);
  client.setAsync = promisify(client.set).bind(client);
  client.watchAsync = promisify(client.watch).bind(client);
  return client;
};

/**
 * Lazily create a client to be used as a subscriber. Subscriber clients are in a special state and cannot be used for
 * other commands.
 *
 * Only one subscriber is necessary for any number of channels.
 *
 * @returns {RedisClient}
 * @private
 */
const _createSubscriber = () => {
  subscriberClient = _createClientBase(subscriberClient);

  subscriberClient.on("error", (err) => {
    _logErrorOnEvent(err, "error event on redis subscriber client");
    subscriberClient.quit();
    subscriberClient = null;
  });

  subscriberClient.on("message", _onMessage);
  return subscriberClient;
};

const _clientExec = async (functionName, argsObject) => {
  if (!client) {
    try {
      client = _createClient();
    } catch (err) {
      throw new VError({ name: VERROR_CLUSTER_NAME, cause: err }, "error during create client");
    }
  }

  try {
    return await client[functionName](...Object.values(argsObject));
  } catch (err) {
    throw new VError(
      { name: VERROR_CLUSTER_NAME, cause: err, info: { functionName, argsObject } },
      "error during redis client %s",
      functionName
    );
  }
};

/**
 * Asynchronously get the value for a given key.
 *
 * @param key
 * @returns {Promise<string|null>}
 */
const get = async (key) => _clientExec("getAsync", { key });

/**
 * Asynchronously get the value for a given key and parse it into an object.
 *
 * @param key
 * @returns {Promise<*>}
 */
const getObject = async (key) => {
  const result = await get(key);
  return result === null ? null : JSON.parse(result);
};

/**
 * Asynchronously set the value for a given key.
 *
 * @param key
 * @param value
 * @returns {Promise<*>}
 */
const set = async (key, value) => _clientExec("setAsync", { key, value });

/**
 * Asynchronously set a stringified object as value for a given key.
 *
 * @param key
 * @param value
 * @returns {Promise<*>}
 */
const setObject = async (key, value) => {
  const valueRaw = JSON.stringify(value);
  return set(key, valueRaw);
};

const _watchedGetSet = async (key, newValueCallback, mode = MODE.OBJECT, attempts = 10) => {
  if (!client) {
    try {
      client = _createClient();
    } catch (err) {
      throw new VError({ name: VERROR_CLUSTER_NAME, cause: err }, "error during create client");
    }
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await client.watchAsync(key);

      const oldValueRaw = await client.getAsync(key);
      const oldValue = mode === MODE.RAW ? oldValueRaw : oldValueRaw === null ? null : JSON.parse(oldValueRaw);
      const newValue = await newValueCallback(oldValue);
      const newValueRaw = mode === MODE.RAW ? newValue : newValue === null ? null : JSON.stringify(newValue);

      if (oldValueRaw === newValueRaw) {
        return oldValue;
      }

      const doDelete = newValueRaw === null;
      const clientMulti = client.multi();
      if (doDelete) {
        clientMulti.del(key);
      } else {
        clientMulti.set(key, newValueRaw);
      }
      const replies = await promisify(clientMulti.exec).bind(clientMulti)();
      if (replies !== null) {
        if (!Array.isArray(replies) || replies.length !== 1 || replies[0] !== (doDelete ? 1 : "OK")) {
          throw new VError(
            { name: VERROR_CLUSTER_NAME, info: { key, attempt, attempts, replies } },
            "received unexpected replies from redis"
          );
        }
        return newValue;
      }
    } catch (err) {
      throw new VError({ name: VERROR_CLUSTER_NAME, cause: err, info: { key } }, "error during watched get set");
    }
  }
  throw new VError({ name: VERROR_CLUSTER_NAME, info: { key, attempts } }, "reached watched get set attempt limit");
};

/**
 * Asynchronously get and then set new value for a given key. The key is optimistically locked, meaning if someone else
 * updates the key concurrently, we lose one attempt and try again until the attempt limit is reached. For subsequent
 * tries, newValueCallback is called each time with the then current old value.
 *
 * Both old and new value are expected to be shallow javascript objects or null. If the key is unknown to redis, the old
 * value passed into newValueCallback is null. If the new value is null, this results in the key being deleted.
 *
 * This function will throw when one of the client instructions fail or when the attempt limit is reached.
 *
 * @param key               key to watch and modify
 * @param newValueCallback  asynchronous callback to compute new value for key, gets old value as input
 * @param attempts          number of attempts to modify key with optimistic locking
 * @returns {Promise<*>}    promise for the new value that was set
 */
const watchedGetSet = async (key, newValueCallback, attempts = 10) =>
  _watchedGetSet(key, newValueCallback, MODE.RAW, attempts);

/**
 * See {@link watchedGetSet}. Difference here is that it does an implicit JSON.parse/JSON.stringify before getting and
 * setting.
 *
 * @param key               key to watch and modify
 * @param newValueCallback  asynchronous callback to compute new value for key, gets old value as input
 * @param attempts          number of attempts to modify key with optimistic locking
 * @returns {Promise<*>}    promise for the new value that was set
 */
const watchedGetSetObject = async (key, newValueCallback, attempts = 10) =>
  _watchedGetSet(key, newValueCallback, MODE.OBJECT, attempts);

/**
 * Asynchronously publish a given message on a given channel. This will lazily create the necessary publisher client.
 * Errors will be re-thrown.
 *
 * @param channel to publish the message on
 * @param message to publish
 * @returns {Promise<void>}
 */
const publishMessage = async (channel, message) => _clientExec("publish", { channel, message });

/**
 * Register a given handler for messages of a given channel. This will lazily create the necessary subscriber client.
 * Errors happening during channel subscribe will be thrown and event errors will be logged.
 *
 * @param channel whose messages should be processed
 * @param handler to process messages
 */
const registerMessageHandler = (channel, handler) => {
  if (!subscriberClient) {
    try {
      subscriberClient = _createSubscriber();
    } catch (err) {
      throw new VError({ name: VERROR_CLUSTER_NAME, cause: err }, "error during create subscriber");
    }
  }
  if (!_hasMessageHandlers(channel)) {
    messageHandlers[channel] = [handler];
    subscriberClient.subscribe(channel);
  } else {
    messageHandlers[channel].push(handler);
  }
};

/**
 * Stop a given handler from processing messages of a given channel.
 *
 * @param channel whose messages should not be processed
 * @param handler to remove
 */
const removeMessageHandler = (channel, handler) => {
  if (!subscriberClient || !_hasMessageHandlers(channel)) {
    return;
  }
  const index = messageHandlers[channel].findIndex((messageHandler) => messageHandler === handler);
  messageHandlers[channel].splice(index, 1);
  if (messageHandlers[channel].length === 0) {
    Reflect.deleteProperty(messageHandlers, channel);
    subscriberClient.unsubscribe(channel);
  }
};

/**
 * Stop all handlers from processing messages of a given channel.
 *
 * @param channel whose messages should not be processed
 */
const removeAllMessageHandlers = (channel) => {
  if (!subscriberClient || !_hasMessageHandlers(channel)) {
    return;
  }
  Reflect.deleteProperty(messageHandlers, channel);
  subscriberClient.unsubscribe(channel);
};

module.exports = {
  get,
  getObject,
  set,
  setObject,
  watchedGetSet,
  watchedGetSetObject,
  publishMessage,
  registerMessageHandler,
  removeMessageHandler,
  removeAllMessageHandlers,

  _: {
    _reset,
    _setRedisIsOnCF,
    _getClient,
    _getSubscriberClient,
    _getMessageHandlers,
    _hasMessageHandlers,
    _onMessage,
    _createClientBase,
    _createClient,
    _createSubscriber,
    _clientExec,
  },
};