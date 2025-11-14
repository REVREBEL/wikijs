import StyleDictionary from 'style-dictionary';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load config from JSON file
const configJson = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

// Create new StyleDictionary instance with config
const sd = new StyleDictionary(configJson);

// Register custom format
sd.registerFormat({
  name: 'css/classes-adapter',
  formatter: function({ dictionary, options }) {
    const { mapFile } = options;
    if (!mapFile) {
      throw new Error('Please supply a mapFile in the format options.');
    }
    
    // Load the mapping file (ESM compatible)
    const mapFilePath = path.resolve(process.cwd(), mapFile);
    const mappingData = fs.readFileSync(mapFilePath, 'utf8');
    const mapping = JSON.parse(mappingData);
    
    // Use v5 API for references
    const resolveValue = (value) => {
      if (dictionary.reference.isReference(value)) {
        try {
          const resolved = dictionary.reference.get(value);
          if (resolved) {
            return resolved.value;
          }
        } catch (err) {
          console.warn(`\n⚠️ Token not found for reference: ${value}`);
        }
        return value; // Return the original reference as a fallback
      }
      return value;
    };

    let css = '';
    for (const selector in mapping) {
      css += `${selector} {\n`;
      const properties = mapping[selector];
      for (const prop in properties) {
        css += `  ${prop}: ${resolveValue(properties[prop])};\n`;
      }
      css += '}\n\n';
    }
    return css;
  }
});

// Build all platforms with proper error handling
async function runBuild() {
  try {
    await sd.buildAllPlatforms();
    console.log('Build completed successfully!');
  } catch (error) {
    console.error('Build failed:', error);
  }
}

runBuild();