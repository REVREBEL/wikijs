const StyleDictionary = require('style-dictionary');
const path = require('path');
const fs = require('fs');

// Create a new instance with config
const sd = new StyleDictionary({
  source: ['tokens/rev/**/*.json'],
  platforms: {
    css: {
      transformGroup: 'css',
      buildPath: 'build/css/',
      files: [
        {
          destination: '_variables.css',
          format: 'css/variables'
        },
        {
          destination: 'adapter.classes.css',
          format: 'css/classes-adapter',
          options: {
            mapFile: './mappings_exact/classes.json'
          }
        }
      ]
    },
    // Copy other platforms from config.json
  }
});

// Register custom format with v5 API
sd.registerFormat({
  name: 'css/classes-adapter',
  formatter: function({ dictionary, options }) {
    const { mapFile } = options;
    if (!mapFile) {
      throw new Error('Please supply a mapFile in the format options.');
    }
    
    // Load mapping file
    const mapping = require(path.resolve(process.cwd(), mapFile));
    
    // Use the V5 API for references
    const resolveValue = (value) => {
      if (dictionary.reference.isReference(value)) {
        const resolvedToken = dictionary.reference.get(value);
        if (resolvedToken) {
          return resolvedToken.value;
        }
        console.warn(`\n⚠️ Token not found for reference: ${value}`);
        return value;
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

// Build all platforms
sd.buildAllPlatforms()
  .then(() => console.log('Build completed successfully!'))
  .catch(error => console.error('Build failed:', error));