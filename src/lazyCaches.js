"use strict";

const DEFAULT_SEPARATOR = "##";
const DEFAULT_EXPIRING_GAP = 100;

class LazyCache {
  constructor({ separator = DEFAULT_SEPARATOR } = {}) {
    this.__data = Object.create(null);
    this.__separator = separator;
  }
  _separator() {
    return this.__separator;
  }
  _data() {
    return this.__data;
  }
  _key(keyOrKeys) {
    return Array.isArray(keyOrKeys) ? keyOrKeys.join(this.__separator) : keyOrKeys;
  }
  has(keyOrKeys) {
    return Object.prototype.hasOwnProperty.call(this.__data, this._key(keyOrKeys));
  }
  get(keyOrKeys) {
    return this.__data[this._key(keyOrKeys)];
  }
  set(keyOrKeys, value) {
    this.__data[this._key(keyOrKeys)] = value;
    return this;
  }
  setCb(keyOrKeys, callback, ...args) {
    return this.set(keyOrKeys, callback(...args));
  }
  async setCbAsync(keyOrKeys, callback, ...args) {
    return this.set(keyOrKeys, await callback(...args));
  }
  getSetCb(keyOrKeys, callback, ...args) {
    const key = this._key(keyOrKeys);
    if (!this.has(key)) {
      this.setCb(key, callback, ...args);
    }
    return this.get(key);
  }
  async getSetCbAsync(keyOrKeys, callback, ...args) {
    const key = this._key(keyOrKeys);
    if (!this.has(key)) {
      await this.setCbAsync(key, callback, ...args);
    }
    return this.get(key);
  }
  count() {
    return Object.keys(this.__data).length;
  }
  delete(keyOrKeys) {
    Reflect.deleteProperty(this.__data, this._key(keyOrKeys));
    return this;
  }
  clear() {
    this.__data = Object.create(null);
  }
}

// NOTE: callback APIs need to return a pair [expirationTime, value]
class ExpiringLazyCache extends LazyCache {
  constructor({ separator = DEFAULT_SEPARATOR, expiringGap = DEFAULT_EXPIRING_GAP } = {}) {
    super({ separator });
    this.__expiringGap = expiringGap;
  }
  _expiringGap() {
    return this.__expiringGap;
  }
  _isValid(expirationTime, currentTime) {
    return expirationTime && (currentTime ?? Date.now()) <= expirationTime + this.__expiringGap;
  }
  has(keyOrKeys, currentTime) {
    if (!super.has(keyOrKeys)) {
      return false;
    }
    const [expirationTime] = super.get(keyOrKeys) ?? [];
    return this._isValid(expirationTime, currentTime);
  }
  get(keyOrKeys, currentTime) {
    const [expirationTime, value] = super.get(keyOrKeys) ?? [];
    return this._isValid(expirationTime, currentTime) ? value : null;
  }
  set(keyOrKeys, expirationTime, value) {
    return super.set(keyOrKeys, [expirationTime, value]);
  }
  setCb(keyOrKeys, callback, ...args) {
    const [expirationTime, value] = callback(...args);
    return this.set(keyOrKeys, expirationTime, value);
  }
  async setCbAsync(keyOrKeys, callback, ...args) {
    const [expirationTime, value] = await callback(...args);
    return this.set(keyOrKeys, expirationTime, value);
  }
  getSetCb(keyOrKeys, currentTime, callback, ...args) {
    const key = this._key(keyOrKeys);
    if (!this.has(key, currentTime)) {
      this.setCb(key, callback, ...args);
    }
    return this.get(key, currentTime);
  }
  async getSetCbAsync(keyOrKeys, currentTime, callback, ...args) {
    const key = this._key(keyOrKeys);
    if (!this.has(key, currentTime)) {
      await this.setCbAsync(key, callback, ...args);
    }
    return this.get(key, currentTime);
  }
}

module.exports = {
  DEFAULT_EXPIRING_GAP,
  DEFAULT_SEPARATOR,
  LazyCache,
  ExpiringLazyCache,
};