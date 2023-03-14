// #!/usr/bin/env node

import path from 'path';
import meow from 'meow';
import B2O from '.';

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
    --folder, -f            Specify the folder that need to be converted ( default: all folders ).
                              Could be used multiple times.
                              'b2o -f Math -f "Business Ideas"' will convert notes only from 'Math'
                              and 'Business Ideas' folders.
    --excludeFolder, -ef    Specify the folder to be excluded ( default: none ). Could be used
                              multiple times.
                              'b2o -ef Math -ef "Business Ideas"' will convert notes from all folders
                              except 'Math' and 'Business Ideas'.
    --tags, -t              Convert tags to hashtags at the top of each note separated by a space.
                              'b2o -t'
    --heading, -h           Include title heading in every note. In Obsidian treat file name as
                              title and automatically adds to the top of displayed note. 
                              'b2o -h'
    --wiki, -w              Convert links and images markdown format to wiki format. Use it if your
                              Obsidian is set to use wiki mode.
                              From '[link text](http://site.com)' to '[[http://site.com|link text]]',
                              from ![alt text](images/avatar.png "mouse over text") to
                              ![[images/avatar.png|alt=alt text|mouse over text]].
    --links, -l             Try to find linked boostnote and calculate its new name and location
                              based on current config options and update link.
                              Latest version (0.23.0) of BoostnoteNext.Local does not support
                              internal links so most probably left internal links are broken (do not
                              match any note).
                              'b2o -l'
    --attachments, -a       Name of the folder to store attachments. By default all attachments will
                              be stored in the same folder as notes. Use this option to define
                              subfolder name that will be created inside notes folder.
                              'b2o -a assets' for notes from Math folder will put attachments in
                              'Math/assets' folder.

    --version               Output version number
    --help                  Output usage information
`,
  {
    importMeta: import.meta,
    imputs: ['source', 'output'],
    flags: {
      folder: {
        type: 'string',
        alias: 'f',
        isMultiple: true,
      },
      excludeFolder: {
        type: 'string',
        alias: 'ef',
        isMultiple: true,
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
      links: {
        type: 'boolean',
        alias: 'l',
        default: false,
      },
      attachments: {
        type: 'string',
        alias: 'a',
        default: null,
      },
    },
  }
);

new B2O({
  source: cli.input[0] || process.cwd(),
  output: cli.input[1] || path.join(process.cwd(), 'out'),
  ...cli.flags,
}).run();
