import { loadPersonas } from "../personas.js";

const personas = await loadPersonas();
const invalid = personas.filter((persona) => !persona.id || !persona.displayName || !persona.title || !persona.description);

console.log(`Loaded ${personas.length} personas.`);
for (const persona of personas) {
  console.log(`- ${persona.id}: ${persona.title}`);
}

if (personas.length < 9) {
  throw new Error(`Expected at least 9 personas, got ${personas.length}.`);
}

if (invalid.length) {
  throw new Error(`Invalid personas: ${invalid.map((persona) => persona.sourcePath).join(", ")}`);
}
