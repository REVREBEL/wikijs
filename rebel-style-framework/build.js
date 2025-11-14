const StyleDictionaryPackage = require('style-dictionary');
const StyleDictionary = StyleDictionaryPackage.default || StyleDictionaryPackage;
const fs = require('fs');
const path = require('path');

// Load config from JSON file
const configJson = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

// Create a new StyleDictionary instance with the config
const sd = new StyleDictionary(configJson);

/**
 * Register a custom format for CSS classes based on a mapping file
 */
sd.registerFormat({
  name: 'css/classes-adapter',
  format: function({ dictionary, options }) {
    const { mapFile } = options;
    if (!mapFile) {
      throw new Error('Please supply a mapFile in the format options.');
    }

    // Load the mapping file
    const mapFilePath = path.resolve(process.cwd(), mapFile);
    const mapping = JSON.parse(fs.readFileSync(mapFilePath, 'utf8'));

    // Resolve token references using the token map provided by Style Dictionary v5
    const referencePattern = /^\{[^}]+\}$/;
    const resolveValue = (value, visited = new Set()) => {
      if (typeof value !== 'string') {
        return value;
      }

      const tokenMap = dictionary.tokenMap;
      if (!tokenMap) {
        return value;
      }

      const token = tokenMap.get(value);
      if (!token) {
        if (referencePattern.test(value)) {
          console.warn(`\n⚠️ Token not found for reference: ${value}`);
        }
        return value;
      }

      if (visited.has(value)) {
        console.warn(`\n⚠️ Circular token reference detected: ${value}`);
        return value;
      }

      visited.add(value);
      return resolveValue(token.value, visited);
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
    process.exitCode = 1;
  }
}

runBuild();
