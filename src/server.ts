/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// List of files with headings nested in them.
interface Heading {
  title: string,
  level: number
}

interface Note {
  filename: string,
  headings: Array<Heading>
}

let notes: Array<Note> = [];
let rootUri: string = '';

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let hasDiagnosticRelatedInformationCapability: boolean = false;

connection.onInitialize((params: InitializeParams) => {
	rootUri = params.workspaceFolders?.[0].uri ?? params.rootUri ?? '';

	let capabilities = params.capabilities;
	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true
			}
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'languageServerExample'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
  addNoteToList(change.document);
	validateTextDocument(change.document);
});

async function addNoteToList(textDocument: TextDocument): Promise<void> {
  let filename = textDocument.uri.replace(rootUri, '');
  const extensionToRemove = '.txt';
  if (filename.endsWith(extensionToRemove)) {
	const fileExtPosition = filename.lastIndexOf(extensionToRemove);
	filename = filename.substr(0, fileExtPosition);
  }
  if (filename.startsWith('/')) {
	  filename = filename.substr(1);
  }
  const existingNote = notes.find((elem) => elem.filename === filename)
  const note = existingNote || {filename: filename, headings: []};
  if (!existingNote) {
    notes.push(note);
  }
  const addHeadingsToNote = (headings: Array<string>) => {
    note.headings = headings.map((heading) => {
      return {title: heading, level: 1};
    })
  }
  findHeadingsInDocument(textDocument, addHeadingsToNote);
}

async function findHeadingsInDocument(textDocument: TextDocument, addToNote: Function) : Promise<void> {
  const textContent = textDocument.getText();
  const textArrayOnNewlines = textContent.split('\n');
  const re = /^(#+) (.+)/g
  let matches = textArrayOnNewlines.map((line) => {
	  const lineMatches = re.exec(line);
	  let firstMatch = lineMatches?.[0] ?? '';
	  firstMatch = firstMatch.replace('#', '').trim();
	  return firstMatch;
  })
  matches = matches.filter((elem) => {
    return elem !== ''
  });

  addToNote(matches);
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	// In this simple example we get the settings for every validate run.
	// let settings = await getDocumentSettings(textDocument.uri);

	// The validator creates diagnostics for all uppercase words length 2 and more
	let text = textDocument.getText();
	let pattern = /\b[A-Z]{2,}\b/g;
	let m: RegExpExecArray | null;

	let problems = 0;
	let diagnostics: Diagnostic[] = [];
	while ((m = pattern.exec(text)) && problems < 300) {
		problems++;
		let diagnostic: Diagnostic = {
			severity: DiagnosticSeverity.Warning,
			range: {
				start: textDocument.positionAt(m.index),
				end: textDocument.positionAt(m.index + m[0].length)
			},
			message: `${m[0]} is all uppercase.`,
			source: 'ex'
		};
		if (hasDiagnosticRelatedInformationCapability) {
			diagnostic.relatedInformation = [
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: 'Spelling matters'
				},
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: 'Particularly for names'
				}
			];
		}
		diagnostics.push(diagnostic);
	}

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		// The pass parameter contains the position of the text document in
		// which code complete got requested. For the example we ignore this
		// info and always provide the same completion items.

		const currentDoc = documents.get(_textDocumentPosition.textDocument.uri)
    if (!currentDoc) return [];

    const docText = currentDoc.getText();
    const positionOffset = currentDoc.offsetAt(_textDocumentPosition.position);
    let currentPosition = positionOffset;
    let currentChar = docText[currentPosition];

    let afterHeadingMarker = false;
    let headingMarkerPosition = 0;
    let firstClosingBraceHit = false;
    let firstOpeningBraceHit = false;
    const exitChars = ['\n', '\r\n'];

    do {
      if (currentChar == '#') {
        afterHeadingMarker = true;
        headingMarkerPosition = currentPosition;
      }
      else if (currentChar == '[') {
        if (firstOpeningBraceHit) {
          if (afterHeadingMarker) {
            const filename = docText.substring(currentPosition+2, headingMarkerPosition);
            return headerCompletionResults(filename);
          }
          return fileCompletionResults();
        }
        else {
          firstOpeningBraceHit = true;
        }
      }
      else if (currentChar == ']' ) {
        if (firstClosingBraceHit) {
          return [];
        }
        firstClosingBraceHit = true;
      }
      else {
        firstClosingBraceHit = false;
        firstOpeningBraceHit = false;
      }

	  currentPosition = currentPosition - 1;
      currentChar = docText[currentPosition];
    } while (exitChars.indexOf(currentChar) === -1)

    return [];
 	}
);

const headerCompletionResults = (filename: string) => {
  const matchingNote = notes.find((note) => {
    return note.filename === filename;
  })
  return matchingNote?.headings.map((heading, index) => {
    return {
      label: heading.title,
      king: CompletionItemKind.Text,
      data: index,
    }
  }) ?? [];
}

const fileCompletionResults = () => {
  return notes.map((note, index) => {
    return {
	    label: note.filename,
      kind: CompletionItemKind.Text,
			data: index
		}
	})
}

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		if (item.data === 1) {
			item.detail = 'TypeScript details';
			item.documentation = 'TypeScript documentation';
		} else if (item.data === 2) {
			item.detail = 'JavaScript details';
			item.documentation = 'JavaScript documentation';
		}
		return item;
	}
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
