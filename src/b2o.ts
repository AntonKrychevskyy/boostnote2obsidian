// #!/usr/bin/env node

import path from 'path';
import meow from 'meow';
import B2O from './boostnote2obsidian.js';

const cli = meow(
  `
  Usage:
    b2o [options] [source] [output]
  
  Inputs:
    source                  Specify the input path, which includes 'boostnote.json'. Optional –
                              by default will look in current directory.
                              'b2o ./boostnote' will look in './boostnote' folder.
                              'b2o ~/Apps/boostnote' will look in '~/Apps/boostnote' folder.
    output                  Specify the output path. Optional – by default will create 'out' folder
                              inside current directory. If it needs to be set to other then default
                              value, the 'source' value should be explicitly entered before.
                              'b2o ./boostnote ~/obsidian' will create 'obsidian' folder in home
                              directory and put there coverting results.

  Options:
    --includeFolder, -i     Specify folder that need to be converted ( default: all folders ). Could
                              be used multiple times.
                              'b2o -i Math -i "Business Ideas"' will convert notes only from 'Math'
                              and 'Business Ideas' folders.
    --excludeFolder, -e     Specify folders to be excluded ( default: none ). Could be used multiple
                              times.
                              'b2o -e Math -e "Business Ideas"' will convert notes from all folders
                              except 'Math' and 'Business Ideas'.
    --tags, -t              Convert tags to hashtags at the top of each note separated by a space.
                              'b2o -t'
    --heading, -h           Include title heading in every note. Obsidian treat file name as
                              title and automatically adds heading to the top of displayed note. So
                              explicit heading is not needed. But if you want to have it, use this 
                              'b2o -h'
    --wiki, -w              Convert links and images markdown format to wiki format. Use it if your
                              Obsidian is set to use wiki mode.
                              From [Relative Document](Some%20Category/Sub%20Category/Document)
                              to [[Some Category/Sub Category/Document|Relative Document]],
                              from ![alt text](images/avatar.png "mouse over text")
                              to ![[images/avatar.png|alt text]].
                              External links '[link text](http://site.com "click me")' do not has
                              wiki format alternative, so they stay in markdown format.
    --attachments, -a       Name of subfolder in note's folder to store attachments. By default its
                              name is 'attachments'. Use this option to define desired name for it.
                              You can set empty string to store attachments directly in note's folder.
                              'b2o -a assets' for notes from Math folder will put attachments in
                              'Math/assets' folder.
                              'b2o -a ""' for notes from Math folder will put attachments in
                              'Math' folder.

    --version               Output version number
    --help                  Output usage information
`,
  {
    importMeta: import.meta,
    flags: {
      includeFolder: {
        type: 'string',
        alias: 'i',
        isMultiple: true,
        default: [],
      },
      excludeFolder: {
        type: 'string',
        alias: 'e',
        isMultiple: true,
        default: [],
      },
      tags: {
        type: 'boolean',
        alias: 't',
        default: false,
      },
      heading: {
        type: 'boolean',
        alias: 'h',
        default: false,
      },
      wiki: {
        type: 'boolean',
        alias: 'w',
        default: false,
      },
      attachments: {
        type: 'string',
        alias: 'a',
        default: 'attachments',
      },
    },
  }
);

new B2O({
  source: cli.input[0] || process.cwd(),
  output: cli.input[1] || path.join(process.cwd(), 'out'),
  ...cli.flags,
}).run();
