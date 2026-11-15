// Keep private, copyrighted content out of Git; preserve existing imports.
import { copyFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
for (const name of ['book-chunks', 'scoring-samples']) {
  const target = new URL('../data/' + name + '.json', import.meta.url);
  try { await access(target); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { await copyFile(new URL('../data/' + name + '.example.json', import.meta.url), target, constants.COPYFILE_EXCL); }
    catch (copyError) { if (copyError.code !== 'EEXIST') throw copyError; }
    console.log('Initialized optional private content: ' + name);
  }
}
