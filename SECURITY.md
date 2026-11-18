# Security and privacy

This project processes professional-network data. Run it privately, collect only
the fields you need, and obtain consent from every person whose account or data
you connect.

## Provider credentials

- Never commit `.env` files, API keys, cookies, or browser session data.
- Use `UNIPILE_API_KEY` only on the server.
- Rotate a provider key immediately if it is exposed.
- Prefer the CSV import mode when live provider access is not required.

## Data retention

Provide a way for users to delete imported connections and disconnect provider
accounts. Do not treat a public profile URL as permission to store or redistribute
more data than the provider allows.

## Reporting a vulnerability

Please report security issues privately to the repository maintainers rather than
opening a public issue with exploit details.
