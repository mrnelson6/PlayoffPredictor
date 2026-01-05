# Design Doc

## Overview

A website that lets people predict the results of the 2026 nfl playoff results by selecting the winners of matchups each rounds until they get to a super bowl winner. This will be accessed by either desktop or mobile phone.

### Tech stack

Website client is html and javascript that communicantes with a google appscript that writes data into a google sheet.

### Dependencies

- NFL Data:
  We will add a sheet to my google sheet that will contain the JSON for what the actual playoff looks like. And we will update this after each game.

  I want the team logos to be visisble in the bracket. 

  I want the bracket to also show the games location and time of game if its known

  For completed games it will show the winner and score.

### User profiles

For right now these profiles will just be used with this site but I want them to be stored/created in a way that it will be easy for me to connect these user profiles to other websites I make.


### Home page

#### Sections

- Login/Logout/Accout name/Signup depending on sign in status
- Playoff bracket, if not logged  in it will just show a bracket of the nfl playoffs in "read only" mode so that they can't make selections and let them know they need to sign in , if they are logged in they can view their picks and change them if they want.
- Groups, everyone can see public groups but once I've joined a private group it will show up in the groups list

### Site details

Aside from making a bracket people need to be able to compete against their friends. To enable this people need to be able to make groups and invite their friends. This means that we will need user profiles for people's data to persist and be associated with them so only they can edit their brackets and others cant. 

When creating a group the options are:
- Group name
- Public/Private
- Buyin (options required, none, optional)
- Buyin price (if above is required or optional let people decide the price)
- Payment details (if there is a buyin link to venmo or other payment platform)

When you create a group it will generate a link to a group so that you can share it.

When someone clicks on a group it will take them to a site to join the group.
- If they haven't made an account yet they will be prompted to make an account or to login once they make an account it will go to the next step
- If they have an account and are loged in it will show them a prompt that shows the group details and has a button to Join or refuse

When someone joins a bracket it is a "user" that joins a group. Each user has only one bracket. So as a user I can make a bracket without being in any groups and join as many as I want later or join a group and make my bracket later.

When I make changes to my playoff bracket I will push a submit button to submit my changes. If Im signed in and haven't completed my bracket there should be something to let me know I haven't submitted a bracket yet or I haven't submitted my changes. As soon as the first NFL game starts everyone will be prohitibted from changing their brackets.

When I click on a group I can see how many people are in it, who is in it (accout name) of each team and once the first playoff game starts you can see other people's brackets, and how many points they currently have and who they picked to win

#### How the NFL playoff bracket works:

There are 2 sides the NFC and AFC, the 1 seed in the NFC and the AFC get a first round bye. The first round matchups on each side are 2 seed vs 7 seed 3 vs 6 and 4 vs 5. In the 2nd round the 1st seed plays the lowest remaining seed and the other 2 teams play each other.
  - Example in NFC side: 

  1st round:
    1st seed gets bye
    2 plays 7: 7 wins
    3 plays 6: 3 wins
    4 plays 5: 4 wins

  2nd round: 
    1 plays 7: 1 wins
    3 plays 4: 3 wins

  3rd round:
    1 plays 3: 3 wins

  4th round (Super bowl): 3 seed from NFC plays the winner of the AFC (follows the same rules)

#### How our users playoff brackets will be scored

Because 2nd round matchups are not set in stone, for example I can predict this 1st round: 

  1st round:
    1st seed gets bye
    2 plays 7: 2 wins
    3 plays 6: 3 wins
    4 plays 5: 4 wins

  and then in my predicted bracket the 2nd round would look like this:

  2nd round: 
    1 plays 4
    2 plays 3

  but if the 1st round actually goes like 

  1st round:
    1st seed gets bye
    2 plays 7: 7 wins (got this wrong)
    3 plays 6: 3 wins (got this right)
    4 plays 5: 4 wins (got this right)

  The 2nd round would look like this:

  2nd round: 
    1 plays 7
    3 plays 4

  so we got 2 out of 3 games right in the 1st round but it changed the 2nd round matchup. We will just award users points for predicting teams to go to win a round that they predicted. Predicting a team to win a 1st round matchup is worth 2 points, predicting a team to win a 2nd round matchup is worth 4 and predicting a 3rd round matchup is worth 6 and predicting the super bowl is worth 8 points by default but when creating a group the group leader can configure those point values and when joining a group the scoring should be explained to the user


#### More bracket details

When viewing the bracket it needs to be clear what games haven't happened yet, what games have happened already and teams you predicted to win a game correctly and teams that you predicted  to lose but won.

### Misc:
I want a subpage that aggregates all brackets made by all users and shows who the group predicts to win each matchup along with a percentage brakedown.