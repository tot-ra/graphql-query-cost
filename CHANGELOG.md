# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2022-03-17

### Changed

- Improved recursion handling with fragments (in case relay is used)
- Added `recursionMultiplier` for better recursion control
- Added debugging (useful in tests in case of complex queries)

## [1.0.0] - 2020-12-17

### Added

- Graphql cost map extraction from schema. Also cleans up the schema of "cost" directive as apollo federation does not allow custom directives.
- Graphql query cost calculation using the cost map
- Example of usage with express + apollo-server

[unreleased]: https://github.com/pipedrive/graphql-query-cost/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/pipedrive/graphql-query-cost/compare/v1.0.0...v1.0.0
[unreleased]: https://github.com/pipedrive/graphql-query-cost/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/pipedrive/graphql-query-cost/tree/v1.0.1


[Unreleased]: https://github.com/pipedrive/graphql-query-cost/compare/v2.0.2...HEAD
[2.0.2]: https://github.com/pipedrive/graphql-query-cost/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/pipedrive/graphql-query-cost/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/pipedrive/graphql-query-cost/tree/v2.0.0