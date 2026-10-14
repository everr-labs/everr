export class StorageNotReadyError extends Error {
  name = "StorageNotReadyError";

  constructor(message = "Storage is not ready.") {
    super(message);
  }
}
