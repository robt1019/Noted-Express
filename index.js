require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const debug = require("debug")("http");
const compression = require("compression");
const helmet = require("helmet");
const jwks = require("jwks-rsa");
const socketioJwt = require("socketio-jwt");
const Notes = require("./models/notes.model");
const { diff_match_patch } = require("diff-match-patch");
const dmp = new diff_match_patch();

const port = process.env.PORT || 3000;

const app = express();

app.use(express.json());
app.use(compression());
app.use(helmet());

mongoose.connect(process.env.ATLAS_URI, {
  useNewUrlParser: true,
  useCreateIndex: true,
  useUnifiedTopology: true,
});

const connection = mongoose.connection;

connection.once("open", () => {
  debug("MongoDB database connection established correctly");
});

const server = app.listen(port, () =>
  debug(`notes api listening at https://localhost:${port}`)
);

const io = require("socket.io")(server);

const patch = (string, diff) => {
  dmp.diff_cleanupSemantic(diff);
  const patches = dmp.patch_make(string, diff);
  const patched = dmp.patch_apply(patches, string);
  return patched[0];
};

io.sockets
  .on(
    "connection",
    socketioJwt.authorize({
      secret: jwks.expressJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: process.env.JWKS_URI,
      }),
      timeout: 15000, // 15 seconds to send the authentication message
    })
  )
  .on("authenticated", (socket) => {
    const userId = socket.decoded_token.sub;

    socket.join(userId);

    // disconnect from socket to force user to reauthenticate
    setTimeout(() => {
      socket.disconnect(true);
    }, 900000);

    Notes.findOne({ username: userId }).then((notes) => {
      io.to(userId).emit(
        "initialNotes",
        JSON.stringify(notes ? notes.notes : notes)
      );
    });

    socket.on("createNote", (payload) => {
      debug(`creating new note for user: ${userId}`);
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
          ).then(() =>
            io.to(userId).emit("noteCreated", {
              id: payload.id,
              title: payload.title,
              body: payload.body,
            })
          );
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
          });
        }
      });
    });

    socket.on("updateNote", (payload) => {
      debug(`updating ${userId} note ${payload.id}`);
      if (!(payload && payload.id && payload.title && payload.body)) {
        debug("malformed updateNote request", JSON.stringify(payload));
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
          ).then(() =>
            io.to(userId).emit("noteUpdated", {
              id: payload.id,
              title: payload.title,
              body: payload.body,
            })
          );
        } else {
          const newTitle = patch("", payload.title);
          const newBody = patch("", payload.body);
          Notes.create({
            username: userId,
            notes: new Map().set(payload.id, {
              title: newTitle,
              body: newBody,
            }),
          }).then(() => {
            io.to(userId).emit("noteUpdated", {
              id: payload.id,
              title: payload.title,
              body: payload.body,
            });
          });
        }
      });
    });

    socket.on("deleteNote", (noteId) => {
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
        });
      });
    });

    socket.on("disconnect", (reason) => {
      debug("user disconnected", reason);
    });
  });
