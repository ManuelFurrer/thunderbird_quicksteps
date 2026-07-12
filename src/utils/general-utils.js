function generateId() {
  return "qs_" + crypto.randomUUID();
}

export { generateId };
