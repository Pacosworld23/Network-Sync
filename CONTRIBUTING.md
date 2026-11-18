# Contributing

## Development

1. Copy `.env.example` to `.env`.
2. Leave `LINKEDIN_PROVIDER=csv` unless you have your own provider account.
3. Install dependencies with `npm run install:ci`.
4. Run tests with `npm test`.
5. Run the local preview with `npm run dev`.

## Provider integrations

Keep provider-specific code behind an adapter. The core application must remain
usable with CSV imports and must not require a paid LinkedIn data provider.

Do not add cookie automation, credential collection, or undocumented LinkedIn
endpoints to the project.
