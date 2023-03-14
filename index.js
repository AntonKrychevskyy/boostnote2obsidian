import path from 'path';
import fs from 'fs-extra';
// import ora from 'ora';
// import colors from 'colors/safe.js';
import sanitizeFilename from 'sanitize-filename';

import { TITLE_REGEX } from './constants';

export default class Boostnote2Obsidian {
  constructor(config = {}) {
    this.inputPath = path.resolve(cwd, config.inputPath || DEFAULT_INPUT_PATH);
    this.outputPath = path.resolve(cwd, config.outputPath || DEFAULT_OUTPUT_PATH);
    // this.folders = {};
  }

  async run() {
    try {
      // this.ora = ora({
      //   text: 'Searching',
      //   stream: process.stdout,
      // }).start();
      // this.folders = await this.readFoldersInfo();

      const notes = await this.listNotes();
      // this.ora.stopAndPersist({ text: `Found ${notes.length} notes.` }).start();

      for (let index = 0; index < notes.length; index++) {
        const note = notes[index];
        await this.readNote(note);
      }
      // this.ora.succeed(colors.green('Done.'));
    } catch (err) {
      // this.ora.fail(colors.red(err.message));
    }
  }

  // async readFoldersInfo() {
  //   const filePath = path.resolve(this.inputPath, 'boostnote.json');
  //   this.ora.text = `Reading ${filePath}`;
  //   const info = await fs.readFile(filePath, 'utf-8');
  //   const json = JSON.parse(info);
  //   const folders = json.folders;
  //   return folders.reduce((result, { key, name }) => {
  //     result[key] = name;
  //     return result;
  //   }, {});
  // }

  async listNotes() {
    const dirPath = path.resolve(this.inputPath, 'notes');
    // this.ora.text = `Reading ${dirPath}`;
    const files = await fs.readdir(dirPath);
    return files.filter(item => item.endsWith('.json'));
  }

  async readNote(fileName) {
    const filePath = path.resolve(this.inputPath, 'notes', fileName);
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const parsedObj = JSON.parse(fileContent);
    if (parsedObj.trashed === true) return;

    await this.parseNote(parsedObj);
  }

  async makeFolderDirectories(folderPath, nextFolder = '') {
    const outputFolderPath = path.join(this.outputPath, folderPath, nextFolder);
    try {
      await fs.ensureDir(outputFolderPath);
    } catch (error) {
      console.log('---debug: folder error', outputFolderPath, error);
    }

    return outputFolderPath;
  }

  async parseNote(obj) {
    let { folderPathname, title, content, tags } = obj;
    const outputFolderPath = await this.makeFolderDirectories(folderPathname);
    tags = tags.map(tag => '#' + tag).join(' ');
    content = tags + '\n\n' + content.replace(/^# [ #a-zA-Zа-яА-Я0-9-–.,]*[\n\s]*/g, '');
    title = this.sanitizeTitle(title);
    // TODO: add attachments processing
    try {
      await fs.writeFile(path.resolve(outputFolderPath, title + '.md'), content, 'utf-8');
    } catch (error) {
      console.log('---debug: note error', title, error);
    }
  }

  sanitizeTitle(title) {
    // remove directory paths and invalid characters, see viko16/boost2fs#1
    // fix unexpected too long title, see viko16/boost2fs#2
    return sanitizeFilename(title).substring(0) || '<noname>';
  }
}
