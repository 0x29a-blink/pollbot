# 🗳️ PollBot

PollBot is a feature-rich, image-generating Discord polling bot built with **TypeScript**, **Discord.js**, and **Playwright**. It moves beyond simple text embeds to create beautiful, shareable images for your polls, complete with live statistics, internationalization support, and robust management tools.

![PollBot Banner](https://via.placeholder.com/1200x400?text=PollBot+Feature+Banner)

## ✨ Features

- **🎨 Image-Based Polls**: Renders high-quality images for every poll, displaying options, descriptions, and creators in a clean, professional format.
- **🔢 Flexible Voting**: 
  - **Single & Multi-Select**: Configure minimum and maximum votes per user (`min_votes`, `max_votes`).
  - **🔒 Role Restrictions**: Limit voting to specific roles (e.g., `@Members` only).
  - **⚖️ Weighted Voting**: Assign voting power to roles (e.g., `@Admin` votes count as 5).
  - **Dynamic Updates**: Images and vote counts update in real-time.
- **🌍 Internationalization (i18n)**: Fully localized UI and messages. Supports multiple languages (configurable per server).
- **🛠️ Advanced Management**:
  - **Slash Commands**: `/poll`, `/close`, `/reopen`, `/config`.
  - **Interactive Components**: Options to add "Close Poll" buttons directly to the poll message.
  - **Thread Integration**: Automatically create a thread for discussion when a poll is created.
- **📊 Visual Statistics**: View system performance and usage metrics with the `/stats` command.
- **💾 Persistence**: Powered by Supabase for reliable data storage and state management.

---

## 🖼️ Visual Showcase

### 📝 Creating a Poll
PollBot generates a card for your poll, handling mentions, emojis, and long text gracefully.

![Poll Example](https://i.imgur.com/hkZatLO.png)\
*/poll title: Which feature did you like more? items: Feature 1, Feature 2, Feature 3 max_votes: 2*\
*Example: A multi-select poll asking for feedback, rendered as an image.*

### 📈 System Statistics
Monitor your bot's health with a generated dashboard image.

![Stats Example](https://i.imgur.com/ncnJ1VT.png)\
*Example: The `/stats` command output showing server count, uptime, and resource usage.*

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v18 or higher)
- **Supabase Project** (PostgreSQL database)
- **Discord Bot Token** & **Client ID**

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/pollbot.git
   cd pollbot
   ```

2. **Install Dependencies**
   This project uses `playwright` for rendering, so we need to install browser binaries as well.
   ```bash
   npm install
   # The postinstall script should run automatically, but if not:
   npx playwright install chromium --with-deps
   ```

3. **Configuration**
   Copy the example environment file and fill in your credentials.
   ```bash
   cp .env.example .env
   ```
   **`.env` variables:**
   - `DISCORD_TOKEN`: Your bot token.
   - `DISCORD_CLIENT_ID`: Application ID.
   - `SUPABASE_URL`: Your Supabase project URL.
   - `SUPABASE_KEY`: Your Supabase service_role or anon key (ensure row level security is configured if using anon, otherwise service_role for backend).
   - `DEV_ONLY_MODE`: `true` or `false` (limits commands to a specific guild for testing).
   - `DEV_GUILD_ID`: ID of the testing guild (required if DEV_ONLY_MODE is true).

4. **Database Setup**
   Execute the `schema.sql` file in your Supabase SQL editor to create the necessary tables (`polls`, `guild_settings`, `global_stats`, etc.).

5. **Deploy Commands**
   Register the slash commands with Discord.
   ```bash
   npm run deploy
   ```

6. **Start the Bot**
   ```bash
   # Development
   npm run dev

   # Production
   npm run build
   npm start
   ```

---

## 🛠️ Commands

| Command | Description | Options |
|---------|-------------|---------|
| `/poll` | Create a new poll | `title`, `items`, `description`, `max_votes`, `min_votes`, `public`, `thread`, `allowed_role`, `close_button` |
| `/stats` | View bot statistics | None |
| `/config` | Manage server settings | `poll-buttons`, `locale`, `weights (set/remove/view/clear)` |
| `/close` | Close an active poll | `id` (Message ID of the poll) |
| `/reopen` | Reopen a closed poll | `id` (Message ID of the poll) |

### 🔍 `/poll` Options Detail

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `title` | String | **Yes** | - | The main title of your poll text (max 256 chars). |
| `items` | String | **Yes** | - | A comma-separated list of voting options (e.g., "Yes, No, Maybe"). Max 25 items. |
| `max_votes` | Integer | No | `1` | The maximum number of choices a user can select (e.g., 2 for "Pick 2"). |
| `min_votes` | Integer | No | `1` | The minimum number of choices a user must select. |
| `description` | String | No | - | Additional context or details. |
| `public` | Boolean | No | `True` | If `False`, vote counts are hidden from the results image until the poll is closed. |
| `thread` | Boolean | No | `False` | If `True`, automatically starts a Discord thread. |
| `allowed_role` | Role | No | - | Only users with this role can vote. |
| `close_button`| Boolean | No | `True`* | If `True`, adds a "Close Poll" button. *Subject to server-wide `/config` settings.* |

---

## ⚙️ Usage Tips

- **Mentions**: You can mention users `@user` or roles `@role` in the description and they will be properly rendered in the image.
- **Customization**: Use `/config locale lang:es` to switch the bot's language to Spanish (or other supported languages) for your server.
- **Management**: If you accidentally close a poll, use `/reopen` with the message ID to resume voting.

---

## 📜 License

This project is licensed under the MIT License.
