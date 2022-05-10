## All questions regarding the bot should be redirected to our [support discord server.](https://discord.gg/VZkY8mDJGh)
A poll bot for discord fully utilizes slash commands with interaction menus for choice selection, no more searching for that one emoji for an item.
- A fully slash command-based bot, no more remembering some random prefix.
- Upwards to 25 items per poll (this is a DiscordAPI limitation not my own) is better than the reaction bot polls that are limited to 20 items!!
- fancy display method on poll end automatically sorting the votes from highest to lowest
```Boo
/poll 
  title: Poll Title 
  description: Poll Description\nwith multiline\nsupport
  items: One,Two,Three,Four,Five,Six,Seven,Eight,Nine,Ten  (up to 25 items)
  public: false 
  thread: true
```
![](https://i.imgur.com/x3CSpoP.gif)

### Invite The Bot
Invite the bot using [this](https://discord.com/api/oauth2/authorize?client_id=911731627498041374&permissions=535596367040&scope=applications.commands%20bot) link.
### Create a Poll
Polls are created using the `/poll` command. The command requires 3 input fields
- Title
  - The title for the message embed.
- Description
  - The description for the message embed.
    - To attach a newline to the message add <kbd>\n</kbd> anywhere in the description.
- Items
  - The items for the poll, each item **must** be separated by a <kbd>,</kbd>
- Public
  - Wether or not the poll displays the current poll vote counts.
- Thread
  - True or False, will attach a thread to the current poll. 

You cannot create a poll if you don't have the `MANAGE_GUILD` permission or if you don't have the `"Poll Manager"` role. This applies to closing polls too.
