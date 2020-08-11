require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const debug = require("debug")("http");
const compression = require("compression");
const helmet = require("helmet");
const jwks = require("jwks-rsa");
const socketioJwt = require("socketio-jwt");
const Notes = require("./models/notes.model");
const {
  getInitialNotes,
  updateNote,
  createNote,
  deleteNote,
} = require("./notes-service");

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

    socket.on("getInitialNotes", () => {
      getInitialNotes(userId, io);
    });

    socket.on("offlineUpdates", async (updates) => {
      debug("processing offline updates");
      if (updates && updates.length) {
        for (let i = 0; i < updates.length; i++) {
          const update = updates[i];
          const action = update[0];
          const payload = update[1];

          if (action === "createNote") {
            await createNote(userId, payload, io);
          }

          if (action === "updateNote") {
            await updateNote(userId, payload, io);
          }

          if (action === "deleteNote") {
            await deleteNote(userId, payload, io);
          }
        }
      }
      debug("offline updates processed");
      socket.emit("offlineUpdatesProcessed");
    });

    socket.on("createNote", (payload) => {
      createNote(userId, payload, io);
    });

    socket.on("updateNote", (payload) => {
      debug(`updating ${userId} note ${payload.id}`);
      updateNote(userId, payload, io);
    });

    socket.on("deleteNote", (noteId) => {
      deleteNote(userId, noteId, io);
    });

    socket.on("disconnect", (reason) => {
      debug("user disconnected", reason);
    });
  });
