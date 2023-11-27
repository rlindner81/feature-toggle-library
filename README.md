# SAP BTP Feature Toggle Library

[![npm version](https://img.shields.io/npm/v/@cap-js-community/feature-toggle-library)](https://www.npmjs.com/package/@cap-js-community/feature-toggle-library)
[![monthly downloads](https://img.shields.io/npm/dm/@cap-js-community/feature-toggle-library)](https://www.npmjs.com/package/@cap-js-community/feature-toggle-library)
[![REUSE status](https://api.reuse.software/badge/github.com/cap-js-community/feature-toggle-library)](https://api.reuse.software/info/github.com/cap-js-community/feature-toggle-library)
[![Main CI](https://github.com/cap-js-community/feature-toggle-library/actions/workflows/main-ci.yml/badge.svg)](https://github.com/cap-js-community/feature-toggle-library/commits/main)

SAP BTP feature toggle library enables Node.js applications using the SAP Cloud Application Programming Model to maintain live-updatable feature toggles via Redis.

## Install or Upgrade

```bash
npm install --save @cap-js-community/feature-toggle-library
```

## Features

- Maintain feature toggle states consistently across multiple app instances.
- Feature toggle changes are published from Redis to subscribed app instances with publish/subscribe pattern [PUB/SUB](https://redis.io/topics/pubsub).
- Horizontal app scaling is supported and new app instances will start with the correct state, or fallback values, if they cannot connect to Redis.
- Feature toggle values can be changed specifically for accessors with certain scopes, e.g., for specific tenants, users,...
- Users can register change handler callbacks for specific toggles.
- Users can register custom input validation callbacks for specific toggles.
- Works as a [CDS-plugin](https://cap.cloud.sap/docs/node.js/cds-plugins) and provides a REST service to read and manipulate toggles.

## Peers

- [CAP Extensibility Feature Toggles](https://cap-js-community.github.io/feature-toggle-library/peers/#cap-extensibility-feature-toggles)
- [SAP Feature Flags Service](https://cap-js-community.github.io/feature-toggle-library/peers/#sap-feature-flags-service)

## Documentation

Head over to our [Documentation](https://cap-js-community.github.io/feature-toggle-library/) to learn more.

## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js-community/feature-toggle-library/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2023 SAP SE or an SAP affiliate company and feature-toggle-library contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js-community/feature-toggle-library).
