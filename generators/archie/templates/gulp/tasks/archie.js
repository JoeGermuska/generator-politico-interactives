// Cobbled together from several ArchieML resources, namely:
// + https://github.com/stuartathompson/node-archieml-boilerplate
// + https://github.com/Quartz/aml-gdoc-server
// + https://github.com/newsdev/archieml-js/blob/master/examples/google_drive.js

const fs = require('fs-extra');
const readline = require('readline');
const google = require('googleapis');
const GoogleAuth = require('google-auth-library');
const archieml = require('archieml');
const winston = require('winston');
const path = require('path');
const url = require('url');
const open = require('open');
const htmlparser = require('htmlparser2');
const Entities = require('html-entities').AllHtmlEntities;

const archie = require('../../archie.json');

const fileId = archie.docId;

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
const TOKEN_DIR = process.cwd();
const TOKEN_PATH = path.resolve(TOKEN_DIR, 'google-token.json');

if (!fs.existsSync(TOKEN_DIR)) {
  fs.mkdirSync(TOKEN_DIR);
}

let oauth2Client;

/**
 * @param {Object} token The token to store to disk.
 */
const storeToken = (token) => {
  try {
    fs.mkdirSync(TOKEN_DIR);
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
  fs.writeFile(TOKEN_PATH, JSON.stringify(token));
  winston.log(`Token stored to ${TOKEN_PATH}`);
};

/**
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback to call with the authorized
 *     client.
 */
const getNewToken = (oauth, callback) => {
  const authUrl = oauth.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    approval_prompt: 'force',
  });
  winston.log('Authorize this app by visiting this url: ', authUrl);
  open(authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code in the URL param "code=" here: ', (code) => {
    rl.close();
    oauth2Client.getToken(code, (err, token) => {
      if (err) {
        winston.log('Error while trying to retrieve access token: ', err);
        return;
      }
      oauth2Client.credentials = token;
      storeToken(token);
      callback(oauth2Client);
    });
  });
};

/**
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
const authorize = (credentials, callback) => {
  const clientSecret = credentials.clientSecret;
  const clientId = credentials.clientId;
  const redirectUrl = credentials.redirectUrl;
  const auth = new GoogleAuth();
  oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) {
      getNewToken(oauth2Client, callback);
    } else {
      oauth2Client.credentials = JSON.parse(token);
      callback(oauth2Client);
    }
  });
};

const parseGDoc = (dom) => {
  const tagHandlers = {
    base(tag) {
      let str = '';
      tag.children.forEach((child) => {
        const func = tagHandlers[child.name || child.type] || false;
        if (func) str += func(child);
      });
      return str;
    },
    text(textTag) {
      return textTag.data;
    },
    span(spanTag) {
      return tagHandlers.base(spanTag);
    },
    p(pTag) {
      return `${tagHandlers.base(pTag)}\n`;
    },
    a(aTag) {
      let href = aTag.attribs.href;
      if (href === undefined) return '';

      // extract real URLs from Google's tracking
      // from: http://www.google.com/url?q=http%3A%2F%2Fwww.nytimes.com...
      // to: http://www.nytimes.com...
      if (
        aTag.attribs.href && url.parse(aTag.attribs.href, true).query &&
        url.parse(aTag.attribs.href, true).query.q
      ) {
        href = url.parse(aTag.attribs.href, true).query.q;
      }

      let str = `<a href="${href}">`;
      str += tagHandlers.base(aTag);
      str += '</a>';
      return str;
    },
    li(tag) {
      return `* ${tagHandlers.base(tag)}\n`;
    },
  };

  ['ul', 'ol'].forEach((tag) => {
    tagHandlers[tag] = tagHandlers.span;
  });
  ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach((tag) => {
    tagHandlers[tag] = tagHandlers.p;
  });

  try {
    const body = dom[0].children[1];
    let parsedText = tagHandlers.base(body);


    // Convert html entities into the characters as they exist in the google doc
    const entities = new Entities();
    parsedText = entities.decode(parsedText);

    // Remove smart quotes from inside tags
    parsedText = parsedText.replace(/<[^<>]*>/g, match =>
      match.replace(/”|“/g, '"').replace(/‘|’/g, "'"));

    const archieData = archieml.load(parsedText);
    fs.writeJSON(
      path.resolve(process.cwd(), 'src/templates/data.json'),
      archieData);
    return archieData;
  } catch (e) {
    winston.log('Cannot access that Google Doc', e);
  }
  return null;
};


/**
 * @param {Object} Google Drive authorization
 */
const getExportLink = (auth) => {
  const drive = google.drive({
    version: 'v2',
    auth,
  });
  drive.files.get({ fileId }, (er, doc) => {
    if (er) {
      winston.log('Error accessing gdoc:', er);
      return;
    }
    winston.log(doc);
    const exportLink = doc.exportLinks['text/html'];
    oauth2Client._makeRequest({ // eslint-disable-line no-underscore-dangle
      method: 'GET',
      uri: exportLink,
    }, (err, body) => {
      if (err) {
        winston.log('Error downloading gdoc', err);
        return;
      }
      const handler = new htmlparser.DomHandler((error, dom) => {
        if (err) {
          winston.log('Error parsing gdoc', error);
          return;
        }
        parseGDoc(dom);
      });
      const parser = new htmlparser.Parser(handler);
      parser.write(body);
      parser.done();
    });
  });
};

module.exports = () => {
  authorize(archie, getExportLink);
};
