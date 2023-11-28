# [Simple Poll Bot](https://discord.com/api/oauth2/authorize?client_id=911731627498041374&permissions=191462108352&scope=applications.commands%20bot) 
> All questions regarding the bot should be redirected to our **[support discord server](https://discord.gg/VZkY8mDJGh)**. A poll bot for discord fully utilizes slash commands with interaction menus for choice selection, no more searching for that one emoji to select an item in your polling.
- A fully slash command-based bot, no more remembering some random prefix.
- Upwards to 25 items per poll this is a [DiscordAPI limitation (field: options?*)](https://discord.com/developers/docs/interactions/message-components#select-menu-object-select-menu-structure) not my own which is better than the reaction bot polls that are limited to 20 items!!
- Fancy display method on poll end automatically sorting the votes from highest to lowest
```js
/poll 
  title: Poll Title 
  description: Poll Description\nwith multiline\nsupport
  items: One,Two,Three,Four,Five,Six,Seven,Eight,Nine,Ten (up to 25 items maximum)
  public: false 
  thread: true
```
![](https://i.imgur.com/x3CSpoP.gif)
`/poll title: Poll Title, description: Poll Description\nwith multiline\nsupport. items: One,Two,Three,Four,Five,Six,Seven,Eight,Nine,Ten (up to 25 items maximum) public: false thread: true`

## Invite The Bot
Invite the bot using [this](https://discord.com/api/oauth2/authorize?client_id=911731627498041374&permissions=191462108352&scope=applications.commands%20bot) link.

https://discord.com/api/oauth2/authorize?client_id=911731627498041374&permissions=191462108352&scope=applications.commands%20bot

## Create a Poll
Polls are created using the `/poll` command. The command **requires** 4 input fields
- Title
  - The title for the message embed.
    - There is a character limit of 256 on the title.
- Description
  - The description for the message embed.
    - There is a character limit of 4096 on the description.
    - To attach a newline to the message add <kbd>\n</kbd> anywhere in the description.
- Items
  - Each item has a character limit of 100.
  - The items for the poll, each item **must** be separated by a <kbd>,</kbd>
- Public
  - `TRUE` or `FALSE`
  - Wether or not the poll displays the current poll vote counts.
- Thread
  - Optional to include in your command or not.
  - `TRUE` or `FALSE`
  - Will attach a thread to the current poll. 

You cannot create a poll if you don't have the `MANAGE_GUILD` permission or if you don't have the `"Poll Manager"` role.


## Closing a Poll

With the `MANAGE_GUILD` permission or the `"Poll Manager"` role simply click the `Close Poll` button and you're all set!