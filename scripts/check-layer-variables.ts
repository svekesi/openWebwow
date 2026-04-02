import { getKnexClient } from '../lib/knex-client';
import type { Layer } from '../types';

const pageId = 'e9c9a71d-ff08-4eb5-84af-94bd21c9b046';

async function checkLayerVariables() {
  const db = await getKnexClient();

  const data = await db('page_layers')
    .select('*')
    .where('page_id', pageId)
    .where('is_published', false)
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc')
    .first();

  if (!data || !data.layers) {
    console.log('No layers found');
    process.exit(0);
  }

  function findTextLayers(layers: Layer[], path = ''): any[] {
    const results: any[] = [];
    
    for (const layer of layers) {
      const currentPath = path ? `${path} > ${layer.name}` : layer.name;
      
      if (['text', 'heading'].includes(layer.name) && layer.variables?.text) {
        results.push({
          id: layer.id,
          name: layer.name,
          customName: layer.customName || layer.name,
          path: currentPath,
          variableType: layer.variables.text.type,
          data: layer.variables.text.data
        });
      }
      
      if (layer.children && layer.children.length > 0) {
        results.push(...findTextLayers(layer.children, currentPath));
      }
    }
    
    return results;
  }

  const textLayers = findTextLayers(data.layers);
  
  console.log(`Found ${textLayers.length} text/heading layers with variables.text:`);
  console.log('');
  
  for (const layer of textLayers) {
    console.log('Layer:', layer.customName);
    console.log('  Path:', layer.path);
    console.log('  Type:', layer.variableType);
    console.log('  Data:', JSON.stringify(layer.data, null, 2));
    console.log('');
  }

  process.exit(0);
}

checkLayerVariables();
