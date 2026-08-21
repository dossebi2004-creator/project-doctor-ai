const multer = require('multer');
const { env } = require('../config/env');

// Memory storage: uploaded files exist only as in-memory Buffers on
// req.files, never written to disk. This means there is no path for an
// uploaded file to be executed, served statically, or left behind on the
// filesystem after the request completes.
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: env.MAX_FILE_SIZE_BYTES,
    files: env.MAX_UPLOAD_FILES,
  },
});

module.exports = { uploadFiles: upload.array('files', env.MAX_UPLOAD_FILES) };
