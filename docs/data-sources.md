# LinkedIn data sources

The workbench is designed around a provider-neutral network graph.

## Free mode: LinkedIn export

Each user can request their own connection export from LinkedIn and import the
CSV into the Network view. This is the default mode and requires no API key or
subscription. The imported rows are tagged with their connection owner so an
organization can merge several teammates' exports later.

## Optional live mode: Unipile

Set `LINKEDIN_PROVIDER=unipile` and provide `UNIPILE_API_KEY` to enable live
account linking, connection sync, and relationship-aware search. This is a
bring-your-own-key integration; the open-source project does not bundle a shared
provider credential.

## Official LinkedIn APIs

The official APIs may be available for approved applications and are the safest
long-term adapter to add. They are permission- and use-case-gated, so the core
application must not assume that every deployment can access the Connections API.

## Design rule

Provider adapters may enrich the graph, but the graph, ICP configuration, scoring,
deduplication, and export flows must work without any single provider.
