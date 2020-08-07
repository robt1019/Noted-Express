const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const noteSchema = new Schema({
  title: {
    type: String,
    required: true,
  },
  body: {
    type: String,
    required: true,
  },
});

const notesSchema = new Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  notes: {
    type: Map,
    of: noteSchema,
  },
});

const Notes = mongoose.model("Notes", notesSchema);

module.exports = Notes;
