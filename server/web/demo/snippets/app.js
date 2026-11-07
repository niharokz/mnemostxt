// Counts words in every note.
const words = (text) => text.split(/\s+/).filter(Boolean).length;

export async function count(notes) {
  let total = 0;
  for (const { name, text } of notes) {
    total += words(text);
    console.log(`${name}: ${words(text)}`);
  }
  return total;
}
