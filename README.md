# Telegram Projects for BB

Telegram Projects connects BB projects and conversations to a private Telegram bot. It creates a topic for each project, sends configured agent and Lane Pilot task events, and lets the owner continue BB threads with text or voice.

## Quick start

1. Install the plugin in BB and open **Telegram** in the sidebar.
2. Create a Telegram bot with @BotFather, enable threaded topics, and enter its token in the plugin's **Connection** tab (or use Env Catalog).
3. Enable project sync in **General**, pair the Telegram owner using the displayed link or `/start <code>`, then choose **Create topics**.
4. Open a project topic and use `/menu` to start or connect a BB conversation.

See [Usage](docs/usage.md) for the Telegram interaction guide, [Overview](docs/overview.md) for capabilities, and [Deployment](docs/deployment.md) for setup requirements.

## Documentation

- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Gotchas](docs/gotchas.md)
- [Research notes](docs/research.md)
- [Roadmap](docs/roadmap.md)
