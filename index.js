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
      if (notes) {
        io.to(userId).emit("initialNotes", notes);
      }
    });

    socket.on("updateNotes", (payload) => {
      debug(`updating ${userId} notes`);
      if (!(payload && payload.diff)) {
        return;
      }
      Notes.find({ username: userId }).then((notes) => {
        if (notes && notes.length) {
          const newNotes = dmp.patch_apply(
            dmp.patch_make(notes[0].content, payload.diff),
            notes[0].content
          )[0];

          Notes.updateOne(
            {
              username: userId,
            },
            {
              username: userId,
              content: newNotes,
            }
          ).then(() =>
            io.to(userId).emit("notesUpdated", {
              username: userId,
              diff: newNotes,
            })
          );
        } else {
          const newNotes = dmp.patch_apply(
            dmp.patch_make("", payload.diff),
            ""
          )[0];
          Notes.create({
            username: userId,
            content: newNotes,
          }).then(() => {
            io.to(userId).emit("notesUpdated", {
              username: userId,
              diff: payload.diff,
            });
          });
        }
      });
      socket.on("disconnect", (reason) => {
        debug("user disconnected", reason);
      });
    });
  });
