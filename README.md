# nudge

nudge is a little open source study planner for courses, deadlines, study time and other stuff

you can use the live version at [nudge.neocities.org](https://nudge.neocities.org/) or run it yourself. nudge is a static website so the main app works offline; you do not need an account. HOW ABOUT THAT?

## run it locally

you will need [Node.js](https://nodejs.org/) installed

```bash
git clone https://github.com/tnkrueckergreen/nudge.git
cd nudge
npm install
npm run dev
```

open the local URL shown in your terminal. it will usually be `http://localhost:5173`

you have nudge on your computer now. very powerful indeed

## build it

to make a production build of the static site:

```bash
npm run build
```

the finished site will be in `dist/`

## your data

nudge stores your courses, tasks, plans, and study sessions in your browser’s local storage. nothing gets uploaded and there’s no automatic syncing between devices (sorry!)

also note: clearing your browser or site data (sus ngl) will permanently delete the nud<del>g</del>e data

so...

PLEASE PLEASE PLEASE export a backup from **settings → your data** before clearing anything (or moving to another device)!! you can import the backup later

## nudge reminders

nudge looks at what’s due, how much work is left, what you’ve been putting off, your study streak, and how overloaded your day is. it then gives you reminders about what you ought to be doing

reminders have their own personalities! you can adjust them to be gentle, balanced, or blunt. expect to feel ashamed

## nudge ai

ew ai you might say. well nudge ai is optional. if you want ai, you will have to get the special ai key yourself. it uses google gemini to help you do things like plan your week, break assignments into steps, etc... it might be useful...

to use it, add a gemini key from [google ai studio](https://aistudio.google.com/apikey) in settings. the key stays in your browser and IS NOT included in nudge backups. nudge only sends data to google when you make an ai request

nudge ai is supposed to be more than your ol' ai wrapper. if you find it terrible, confusing, or just a fucking gimmick, lmk

(obviously you need internet to use nudge ai)

## feedback

nudge is probably a bit buggy. i have tried my best to look for the little critters but a few might have escaped my clutches. bug reports, strange behaviour, ideas, and feedback, nice or nasty, are all very welcome.
