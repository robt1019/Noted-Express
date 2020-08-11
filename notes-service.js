const Notes = require("./models/notes.model");
const { diff_match_patch } = require("diff-match-patch");
const dmp = new diff_match_patch();
const debug = require("debug")("http");

const patch = (string, diff) => {
  dmp.diff_cleanupSemantic(diff);
  const patches = dmp.patch_make(string, diff);
  const patched = dmp.patch_apply(patches, string);
  return patched[0];
};

const updateNote = (userId, payload, io) => {
  return new Promise((resolve) => {
    if (!(payload && payload.id && payload.title && payload.body)) {
      debug("malformed updateNote request", JSON.stringify(payload));
      resolve();
      return;
    }
    Notes.findOne({ username: userId }).then((notes) => {
      if (notes) {
        let newTitle, newBody;

        if (notes.notes.get(payload.id)) {
          const oldTitle = notes.notes.get(payload.id).title;
          const oldBody = notes.notes.get(payload.id).body;
          newTitle = patch(oldTitle, payload.title);
          newBody = patch(oldBody, payload.body);
        } else {
          newTitle = patch("", payload.title);
          newBody = patch("", payload.body);
        }

        debug(`updating note with title: ${newTitle} and body ${newBody}`);

        const notesMap = notes.notes;
        notesMap.set(payload.id, { title: newTitle, body: newBody });

        Notes.updateOne(
          {
            username: userId,
          },
          {
            username: userId,
            notes: notesMap,
          }
        ).then(() => {
          io.to(userId).emit("noteUpdated", {
            id: payload.id,
            title: payload.title,
            body: payload.body,
          });
          resolve();
        });
      }
    });
  });
};

const createNote = (userId, payload, io) => {
  debug(`creating new note for user: ${userId}`);
  return new Promise((resolve) => {
    Notes.findOne({ username: userId }).then((notes) => {
      if (notes) {
        debug(
          `creating note with title: ${payload.title} and body ${payload.body}`
        );

        const notesMap = notes.notes;
        notesMap.set(payload.id, {
          title: payload.title,
          body: payload.body,
        });

        Notes.updateOne(
          {
            username: userId,
          },
          {
            username: userId,
            notes: notesMap,
          }
        ).then(() => {
          io.to(userId).emit("noteCreated", {
            id: payload.id,
            title: payload.title,
            body: payload.body,
          });
          resolve();
        });
      } else {
        Notes.create({
          username: userId,
          notes: new Map().set(payload.id, {
            title: payload.title,
            body: payload.body,
          }),
        }).then(() => {
          io.to(userId).emit("noteCreated", {
            id: payload.id,
            title: payload.title,
            body: payload.body,
          });
          resolve();
        });
      }
    });
  });
};

const deleteNote = (userId, noteId, io) => {
  return new Promise((resolve) => {
    debug("deleteNote action received");
    Notes.findOne({ username: userId }).then((notes) => {
      debug("found user's notes, prepping for destruction");
      const notesMap = notes.notes;
      if (notesMap.get(noteId)) {
        notesMap.delete(noteId);
      }
      debug(`notes after deletion ${JSON.stringify(notesMap)}`);
      Notes.updateOne(
        {
          username: userId,
        },
        {
          username: userId,
          notes: notesMap,
        }
      ).then(() => {
        io.to(userId).emit("noteDeleted", noteId);
        debug("note deleted");
        resolve();
      });
    });
  });
};

module.exports = {
  updateNote,
  createNote,
  deleteNote,
};
