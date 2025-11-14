import StyleDictionary from 'style-dictionary';
import { formats, transformGroups } from 'style-dictionary/enums';


const sd = new StyleDictionary({
  source: ['tokens/**/*.json'],
  platforms: {
    scss: {
      transformGroup: transformGroups.scss,
      buildPath: 'build/',
      files: [
        {
          destination: 'variables.scss',
          format: formats.scssVariables,
        },
      ],
    },
    // ...
  },
});

import registerFormats from './build/register-formats.mjs'
registerFormats(StyleDictionary)
await sd.buildAllPlatforms();