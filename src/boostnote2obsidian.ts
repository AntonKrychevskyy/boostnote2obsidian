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

type BoostnoteFoldersMap = Record<string, BoostnoteFolder>;

interface BoostnoteNote extends BoostnoteEntity {
  folderPathname: string;
  title: string;
  tags: string[];
  content: string;
  trashed: boolean;
  _rev: string;
}

type FoldersMap = Map<string, FolderFilesData>;

interface FolderFilesData {
  outputPath: string;
  attachmentsFolderPath: string;
  noteIds: string[];
  noteNames: Map<string, number>;
  attachmentNameDups: Map<string, number>;
  attachmentIdsToNames: Map<string, string>;
}

type NotesUpdateMap = Map<string, NoteUpdateData>;

interface NoteUpdateData {
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

interface NoteUpdateConfig {
  noteId: string;
  noteTitle: string;
  attachmentsFolderPath: string;
  newFolderPath: string;
  relativeFolderPath: string;
  attachmentNameDups: Map<string, number>;
  attachmentIdsToNames: Map<string, string>;
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
  foldersMap: FoldersMap = new Map();
  notesMap: NotesUpdateMap = new Map();

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
    //   1.1 Make Map of all folders
    this.foldersMap = await this.getAllFoldersMap();
    //   1.2 Make Map of all notes
    this.notesMap = await this.getAllNotesMap(this.foldersMap);
    // 2. Get only required folders map
    this.foldersMap = this.getRequiredFoldersMap(this.foldersMap);
    // 3. Get only required notes map
    const requiredNotesMap = this.getRequiredNotesMap(this.notesMap, this.foldersMap);
    // 4. Create required output folders and attachments subfolders
    await this.makeOutputFolders(this.foldersMap);

    for await (const [noteId, noteUpdateData] of requiredNotesMap) {
      const folderData = this.foldersMap.get(noteUpdateData.relativeFolder) as FolderFilesData;
      const noteUpdateConfig: NoteUpdateConfig = {
        noteId,
        noteTitle: noteUpdateData.filename,
        attachmentsFolderPath: folderData.attachmentsFolderPath,
        newFolderPath: folderData.outputPath,
        relativeFolderPath: noteUpdateData.relativeFolder,
        attachmentNameDups: folderData.attachmentNameDups,
        attachmentIdsToNames: folderData.attachmentIdsToNames,
      };
      // 5. Parse note and get note content template
      const noteDataObject = (await this.getNoteDataObject(
        noteUpdateConfig,
        'processing note'
      )) as BoostnoteNote;

      const noteContentTemplate = this.getNoteContentTemplate(noteDataObject);
      // 6. Update attachments in note content template
      await this.updateAttachments(noteContentTemplate, noteUpdateConfig);
      // 7. If needed - update doc references in note content template
      this.updateDocReferences(noteContentTemplate, noteUpdateConfig);
      // 8. Convert note content template to file content
      await this.writeNoteFile(noteContentTemplate, noteUpdateConfig);
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

  private async getAllFoldersMap() {
    const jsonPath = path.resolve(this.sourcePath, 'boostnote.json');
    // this.ora.text = `Reading ${jsonPath}`;
    const json: string = await fs.readFile(jsonPath, 'utf-8');
    const { folderMap }: BoostnoteRegistry = JSON.parse(json);

    const foldersMap: FoldersMap = Object.entries(folderMap).reduce(
      (map, [key, { orderedIds }]) => {
        const noteIds = orderedIds.filter(id => id.startsWith('note:')).map(id => id.slice(5));

        if (!noteIds.length) return map;

        const relativePath = key.slice(1);
        const outputPath = path.join(this.outputPath, relativePath);
        const attachmentsFolderPath = path.join(outputPath, this.attachmentsFolder);

        map.set(relativePath, {
          noteIds,
          outputPath,
          attachmentsFolderPath,
          noteNames: new Map<string, number>(),
          attachmentNameDups: new Map<string, number>(),
          attachmentIdsToNames: new Map<string, string>(),
        });

        return map;
      },
      new Map()
    );

    return foldersMap;
  }

  private async getAllNotesMap(foldersMap: FoldersMap) {
    const notesMap: NotesUpdateMap = new Map();

    for (const [
      relativeFolder,
      { noteIds: notes, outputPath: outputFolder, noteNames },
    ] of foldersMap) {
      for (let noteId of notes) {
        const noteDataObject = await this.getNoteDataObject(
          {
            noteId,
            relativeFolderPath: relativeFolder,
          },
          'all notes mapping'
        );

        if (!noteDataObject) continue;

        const title = this.sanitizeTitle(noteDataObject.title);
        const count = noteNames.has(title) ? noteNames.get(title)! : 0;
        const filename = count ? `${title}(${count})` : title;
        noteNames.set(title, count + 1);

        notesMap.set(noteId, { outputFolder, relativeFolder, filename });
      }
    }

    return notesMap;
  }

  private getRequiredFoldersMap(foldersMap: FoldersMap) {
    return new Map([...foldersMap].filter(([relativePath]) => this.isRequiredFolder(relativePath)));
  }

  private isRequiredFolder(folderPath: string) {
    if (this.isAll) return true;

    const folderPathSegments = folderPath.split('/');

    return (
      (!this.includeFolders.length ||
        !!this.includeFolders.some(folder => folderPathSegments.includes(folder))) &&
      (!this.excludeFolders.length ||
        !this.excludeFolders.some(folder => folderPathSegments.includes(folder)))
    );
  }

  private getRequiredNotesMap(notesMap: NotesUpdateMap, requiredFoldersMap: FoldersMap) {
    return new Map(
      [...notesMap].filter(([_, { relativeFolder }]) => requiredFoldersMap.has(relativeFolder))
    );
  }

  private async getNoteDataObject(
    { noteId, relativeFolderPath }: Pick<NoteUpdateConfig, 'noteId' | 'relativeFolderPath'>,
    processDesc: string
  ) {
    const notePath = path.resolve(this.sourcePath, 'notes', noteId + '.json');

    if (!fs.existsSync(notePath)) {
      console.warn(
        `During ${processDesc} file "${notePath}" from "${relativeFolderPath}" wasn't found.`
      );
      return null;
    }

    const noteDataString = await fs.readFile(notePath, 'utf-8');

    return JSON.parse(noteDataString) as BoostnoteNote;
  }

  private async makeOutputFolders(foldersMap: FoldersMap) {
    for await (const [, { attachmentsFolderPath: attachmentsPath }] of foldersMap) {
      try {
        await fs.ensureDir(attachmentsPath);
      } catch (error) {
        console.error(`Failed to create folder "${attachmentsPath}"`, error);
      }
    }
  }

  private getNoteContentTemplate(noteDataObject: BoostnoteNote) {
    let { content, tags } = noteDataObject;
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

    return { tags, substrings, links, attachments } as NoteContentTemplate;
  }

  private async updateAttachments(
    noteContentTemplate: NoteContentTemplate,
    noteUpdateConfig: NoteUpdateConfig
  ) {
    const { substrings, attachments } = noteContentTemplate;
    const { newFolderPath, noteTitle, ...restNoteUpdateConfig } = noteUpdateConfig;

    for await (const [attachmentReference, { label = '', items }] of attachments) {
      const attachmentPath = path.resolve(this.sourcePath, 'attachments', attachmentReference);

      if (!fs.existsSync(attachmentPath)) {
        console.warn(
          `Attachment "${attachmentPath}" referenced in "${noteTitle}" from "${newFolderPath}" wasn't found.`
        );
        continue;
      }

      const { newFilePath, newFilename } = this.calcNewAttachmentLocation({
        label,
        attachmentReference,
        ...restNoteUpdateConfig,
      });

      await fs.copyFile(attachmentPath, newFilePath);

      for (const { index, label = '', title } of items) {
        if (this.isWikiFormat) {
          substrings[index] = `![[${newFilename}${label ? `|${label}` : ''}]]`;
        } else {
          substrings[index] = `![${label}](${newFilename}${title ? ` "${title}"` : ''})`;
        }
      }
    }
  }

  private calcNewAttachmentLocation({
    label,
    attachmentReference,
    attachmentsFolderPath,
    attachmentIdsToNames,
    attachmentNameDups,
  }: { label: string; attachmentReference: string } & Pick<
    NoteUpdateConfig,
    'attachmentsFolderPath' | 'attachmentIdsToNames' | 'attachmentNameDups'
  >) {
    if (attachmentIdsToNames.has(attachmentReference)) {
      const newFilename = attachmentIdsToNames.get(attachmentReference) as string;
      const newFilePath = path.resolve(attachmentsFolderPath, newFilename);

      return { newFilePath, newFilename };
    }

    const ext = path.extname(attachmentReference);
    const attachmentTitle = label?.replace(/\.+\w+$/g, '') || attachmentReference.replace(ext, '');
    const duplicate = attachmentNameDups.get(attachmentTitle + ext) ?? 0;
    const suffix = duplicate ? `(${duplicate})` : '';
    const newAttachmentName = this.sanitizeTitle(attachmentTitle).replaceAll(' ', '_');
    const newFilename = newAttachmentName + suffix + ext;
    const newFilePath = path.resolve(attachmentsFolderPath, newFilename);

    attachmentIdsToNames.set(attachmentReference, newFilename);
    attachmentNameDups.set(attachmentTitle + ext, duplicate + 1);

    return { newFilePath, newFilename };
  }

  private updateDocReferences(
    noteContentTemplate: NoteContentTemplate,
    noteUpdateConfig: NoteUpdateConfig
  ) {
    const { substrings, links } = noteContentTemplate;
    const { relativeFolderPath, noteTitle } = noteUpdateConfig;

    for (const [noteId, { items }] of links) {
      if (!this.notesMap.has(noteId)) {
        console.warn(
          `Note "${noteId}" referenced in "${noteTitle}" from "${relativeFolderPath}" wasn't found`
        );
        continue;
      }

      const { relativeFolder, filename } = this.notesMap.get(noteId) as NoteUpdateData;
      const newFilePath = relativeFolder ? `${relativeFolder}/${filename}` : filename;

      for (const { index, label = '', title } of items) {
        if (this.isWikiFormat) {
          substrings[index] = `[[${newFilePath}${label ? `|${label}` : ''}]]`;
        } else {
          substrings[index] = `[${label}](${encodeURI(newFilePath)}${title ? ` "${title}"` : ''})`;
        }
      }
    }
  }

  private async writeNoteFile(
    noteContentTemplate: NoteContentTemplate,
    noteUpdateConfig: NoteUpdateConfig
  ) {
    const { tags, substrings } = noteContentTemplate;
    const { newFolderPath, noteTitle } = noteUpdateConfig;
    const content = tags.join(' ') + substrings.join('');
    const filePath = path.resolve(newFolderPath, noteTitle + '.md');

    try {
      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      console.error(`Failed to write "${filePath}" file to disk`, error);
    }
  }

  sanitizeTitle(title: string = '') {
    // remove directory paths and invalid characters
    return sanitizeFilename(title) || '<noname>';
  }
}
