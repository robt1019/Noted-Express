const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const notesSchema = new Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  content: {
    type: String,
    required: true,
  },
});

const Notes = mongoose.model("Notes", notesSchema);

module.exports = Notes;
