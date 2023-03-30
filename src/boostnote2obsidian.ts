import path from 'path';
import fs from 'fs-extra';
// import ora from 'ora';
// import colors from 'colors/safe.js';
import sanitizeFilename from 'sanitize-filename';

import { REFERENCES_REGEX, TITLE_REGEX } from './constants.js';

interface Config {
  source: string;
  output: string;
  includeFolder: string[];
  excludeFolder: string[];
  tags: boolean;
  heading: boolean;
  wiki: boolean;
  attachments: string;
}

interface BoostnoteRegistry {
  tagMap: Record<string, BoostnoteTag>;
  folderMap: BoostnoteFoldersMap;
}

interface BoostnoteEntity {
  data: Record<string, unknown>;
  _id: string;
  createdAt: string;
  updatedAt: string;
}

interface BoostnoteTag extends BoostnoteEntity {}

interface BoostnoteFolder extends BoostnoteEntity {
  orderId: string;
  orderedIds: string[];
}

type BoostnoteFoldersMap = Map<string, BoostnoteFolder>;

interface BoostnoteNote extends BoostnoteEntity {
  folderPathname: string;
  title: string;
  tags: string[];
  content: string;
  trashed: boolean;
  _rev: string;
}

type NotesMap = Map<string, NoteFoldersData>;

interface NoteFoldersData {
  relativeFolder: string;
  outputFolder: string;
  filename: string;
}

type NoteContentMatchArray = [
  string,
  string | undefined,
  string,
  string | undefined,
  string,
  string | undefined,
  string | undefined
] &
  RegExpMatchArray;

interface NoteContentTemplate {
  title: string;
  tags: string[];
  substrings: string[];
  links: Map<string, ReferenceDataObject>;
  attachments: Map<string, ReferenceDataObject>;
}

interface ReferenceDataObject {
  label: string;
  items: Set<ReferenceInstanceObject>;
}

interface ReferenceInstanceObject {
  label: string;
  title: string | undefined;
  index: number;
}

export default class Boostnote2Obsidian {
  sourcePath: string;
  outputPath: string;
  isAll: boolean;
  includeFolders: string[];
  excludeFolders: string[];
  isTagsIncluded: boolean;
  isTitleIncluded: boolean;
  isWikiFormat: boolean;
  attachmentsFolder: string;
  notesMap: NotesMap = new Map();
  errors: string[] = [];

  constructor(config: Config) {
    this.sourcePath = path.resolve(config.source);
    this.outputPath = path.resolve(config.output);
    this.isAll = !config.includeFolder.length && !config.excludeFolder.length;
    this.includeFolders = config.includeFolder;
    this.excludeFolders = config.excludeFolder;
    this.isTagsIncluded = config.tags;
    this.isTitleIncluded = config.heading;
    this.isWikiFormat = config.wiki;
    this.attachmentsFolder = config.attachments;
  }

  // TODO: Refactor variable names
  // TODO: Refactor functions

  async run() {
    // 1. Parse boostnote.json
    const foldersMap = await this.getBoostnoteFoldersMap();
    //   1.1 If need to update doc references make Map of all notes
    this.notesMap = await this.getAllNotesMap(foldersMap);
    //   1.2 Make list of folders with notes and related notes iterator
    const [foldersPathsList, notesList] = this.getFoldersAndNotesLists(foldersMap);
    // 2. Make output folders and notes parsing queue
    await this.makeOutputFolders(foldersPathsList);

    for await (const noteId of notesList) {
      // 3. Parse note returning note content template
      const noteDataObject = await this.getNoteDataObject(noteId);

      if (!noteDataObject) continue;

      const noteContentTemplate = this.getNoteContentTemplate(noteDataObject);
      // 4. Update attachments in note content template
      await this.updateAttachments(noteId, noteContentTemplate);
      // 5. If needed - update doc references in note content template
      this.updateDocReferences(noteContentTemplate);
      // 6. Convert note content template to file content
      await this.writeNoteFile(noteId, noteContentTemplate);
    }

    // try {
    //   this.ora = ora({
    //     text: 'Searching',
    //     stream: process.stdout,
    //   }).start();
    //   this.folders = await this.readFoldersInfo();

    //   const notes = await this.listNotes();
    //   this.ora.stopAndPersist({ text: `Found ${notes.length} notes.` }).start();

    //   for (let index = 0; index < notes.length; index++) {
    //     const note = notes[index];
    //     await this.readNote(note);
    //   }
    //   this.ora.succeed(colors.green('Done.'));
    // } catch (err) {
    //   this.ora.fail(colors.red(err.message));
    // }
  }

  private async getBoostnoteFoldersMap() {
    const jsonPath = path.resolve(this.sourcePath, 'boostnote.json');
    // this.ora.text = `Reading ${jsonPath}`;
    const json: string = await fs.readFile(jsonPath, 'utf-8');
    const { folderMap }: BoostnoteRegistry = JSON.parse(json);

    return folderMap;
  }

  private async getAllNotesMap(foldersMap: BoostnoteFoldersMap) {
    const notesMap: NotesMap = new Map();

    for (const { _id, orderedIds } of Object.values(foldersMap)) {
      const relativeFolder = _id.replace(/^folder\:\//g, '');
      const outputFolder = path.join(this.outputPath, relativeFolder);

      for (let id of orderedIds) {
        if (!id.startsWith('note:')) continue;

        const noteDataObject = await this.getNoteDataObject(id.slice(5));

        if (!noteDataObject) continue;

        const filename = this.sanitizeTitle(noteDataObject.title);
        notesMap.set(id.slice(5), { outputFolder, relativeFolder, filename });
      }
    }

    return notesMap;
  }

  private async getNoteDataObject(noteId: string) {
    const notePath = path.resolve(this.sourcePath, 'notes', noteId + '.json');

    if (!fs.existsSync(notePath)) {
      console.error(`Note file ${notePath} not found.`);
      this.errors.push(`Note file ${notePath} not found.`);
      return null;
    }

    const noteDataString = await fs.readFile(notePath, 'utf-8');

    return JSON.parse(noteDataString) as BoostnoteNote;
  }

  private getFoldersAndNotesLists(foldersMap: BoostnoteFoldersMap) {
    const foldersList: string[] = [];
    const notesList: string[] = [];

    for (const { _id, orderedIds } of Object.values(foldersMap) as BoostnoteFolder[]) {
      const relativePath = _id.split('/').slice(1);

      if (this.isForbiddenFolder(relativePath)) continue;

      const fullPath = path.join(this.outputPath, ...relativePath);
      const notes = orderedIds.filter(id => id.startsWith('note:')).map(id => id.slice(5));

      if (notes.length) {
        foldersList.push(fullPath);
        notesList.push(...notes);
      }
    }

    return [foldersList, notesList] as [string[], string[]];
  }

  private isForbiddenFolder(folderPathSegments: string[]) {
    if (this.isAll) return false;

    return (
      (!!this.includeFolders.length &&
        !this.includeFolders.some(folder => folderPathSegments.includes(folder))) ||
      (!!this.excludeFolders.length &&
        this.excludeFolders.some(folder => folderPathSegments.includes(folder)))
    );
  }

  private async makeOutputFolders(foldersList: string[]) {
    for await (const outputFullPath of foldersList) {
      try {
        const attachmentsFolderPath = path.join(outputFullPath, this.attachmentsFolder);
        await fs.ensureDir(attachmentsFolderPath);
      } catch (error) {
        console.error(`Failed to create folder ${outputFullPath}`, error);
        this.errors.push(`Failed to create folder ${outputFullPath}`);
      }
    }
  }

  private getNoteContentTemplate(noteDataObject: BoostnoteNote) {
    let { title, content, tags } = noteDataObject;
    title = this.sanitizeTitle(title);
    tags = this.isTagsIncluded ? tags.map(tag => `#${tag}`).concat(['\n\n']) : [];
    content = this.isTitleIncluded ? content : content.replace(TITLE_REGEX, '');

    const substrings = [];
    const links = new Map<string, ReferenceDataObject>();
    const attachments = new Map<string, ReferenceDataObject>();
    let prevPosition = 0;

    for (const matchData of content.matchAll(REFERENCES_REGEX)) {
      const [matchString, attachmentMarker, label, noteMarker, reference, _, title] =
        matchData as NoteContentMatchArray;
      const position = matchData.index!;
      const hasPresedingSubstring = prevPosition < position;

      const type =
        (!!attachmentMarker && 'attachment') || (!!noteMarker && 'internal') || 'external';

      if (hasPresedingSubstring) substrings.push(matchData.input!.slice(prevPosition, position));
      substrings.push(matchString);
      prevPosition = position + matchString.length;

      if (type === 'external') continue;

      const collection = type === 'attachment' ? attachments : links;

      const refereceData = collection.has(reference)
        ? (collection.get(reference) as ReferenceDataObject)
        : (collection
            .set(reference, { label, items: new Set() })
            .get(reference) as ReferenceDataObject);
      refereceData.items.add({ label, title, index: substrings.length - 1 });
    }

    if (prevPosition < content.length) substrings.push(content.slice(prevPosition));

    return { title, tags, substrings, links, attachments } as NoteContentTemplate;
  }

  private async updateAttachments(noteId: string, noteContentTemplate: NoteContentTemplate) {
    const { substrings, attachments } = noteContentTemplate;
    const { outputFolder } = this.notesMap.get(noteId) as NoteFoldersData;
    const attachmentsFolder = path.resolve(outputFolder, this.attachmentsFolder);

    for await (const [attachmentReference, { label, items }] of attachments) {
      const attachmentPath = path.resolve(this.sourcePath, 'attachments', attachmentReference);

      if (!fs.existsSync(attachmentPath)) {
        console.error(`Attachment ${attachmentPath} not found`);
        this.errors.push(`Attachment ${attachmentPath} not found`);
        continue;
      }

      const ext = path.extname(attachmentPath);
      const referenceName = label.replace('/.+w+$/g', '') || attachmentReference.replace(ext, '');
      const newFilename = this.sanitizeTitle(referenceName).replaceAll(' ', '_') + ext;
      const newFilePath = path.resolve(attachmentsFolder, newFilename);

      await fs.copyFile(attachmentPath, newFilePath);

      for (const { index, label, title } of items) {
        if (this.isWikiFormat) {
          substrings[index] = `![[${newFilename}${label ? `|${label}` : ''}]]`;
        } else {
          substrings[index] = `![${label}](${newFilename}${title ? ` "${title}"` : ''})`;
        }
      }
    }
  }

  private updateDocReferences(noteContentTemplate: NoteContentTemplate) {
    const { substrings, links } = noteContentTemplate;

    for (const [linkReference, { items }] of links) {
      if (!this.notesMap.has(linkReference)) {
        console.warn(`Linked note ${linkReference} not found`);
        this.errors.push(`Linked note ${linkReference} not found`);
        continue;
      }

      const { relativeFolder, filename } = this.notesMap.get(linkReference) as NoteFoldersData;
      const newFilePath = relativeFolder ? `${relativeFolder}/${filename}` : filename;

      for (const { index, label, title } of items) {
        if (this.isWikiFormat) {
          substrings[index] = `[[${newFilePath}${label ? `|${label}` : ''}]]`;
        } else {
          substrings[index] = `[${label}](${encodeURI(newFilePath)}${title ? ` "${title}"` : ''})`;
        }
      }
    }
  }

  private async writeNoteFile(noteId: string, noteContentTemplate: NoteContentTemplate) {
    const { title, tags, substrings } = noteContentTemplate;
    const content = tags.join(' ') + substrings.join('');
    const { outputFolder } = this.notesMap.get(noteId) as NoteFoldersData;
    const filePath = path.resolve(outputFolder, title + '.md');

    try {
      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      console.error(`Failed to write ${filePath} file on disk`, error);
      this.errors.push(`Failed to write ${filePath} file on disk`);
    }
  }

  sanitizeTitle(title: string = '') {
    // remove directory paths and invalid characters
    return sanitizeFilename(title) || '<noname>';
  }
}
