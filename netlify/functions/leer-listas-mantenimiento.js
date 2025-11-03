const { google } = require('googleapis');

// --- Configuración de Autenticación ---
function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

function getSheetsAPI(auth) {
  return google.sheets({ version: 'v4', auth });
}

// --- Handler Principal ---
exports.handler = async function (event) {
  
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Usamos una variable nueva para el ID de la hoja de Configuración
    const spreadsheetId = process.env.CONFIGURACIONMAN_SHEET_ID;
    
    if (!spreadsheetId) {
      // Mensaje de error actualizado
      throw new Error('El ID de la hoja de Configuración no está configurado.');
    }

    const auth = getAuth();
    const sheets = getSheetsAPI(auth);

    // 1. Definimos los rangos que queremos leer
    const ranges = [
      'Hoja 1!A2:C', // Relaciones Area -> Maquina -> Estacion
      'Hoja 1!D2:D'  // Soluciones
    ];

    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: spreadsheetId, // Usamos la variable correcta
      ranges: ranges,
    });

    const valueRanges = response.data.valueRanges || [];

    // 2. Procesar Relaciones (A, B, C)
    const dataRelaciones = valueRanges[0]?.values || [];
    const structuredData = {};

    for (const [area, maquina, estacion] of dataRelaciones) {
      // Asegurarse de que las tres celdas tengan datos
      if (!area || !maquina || !estacion) continue; 
      
      // Crear el objeto de Area si no existe
      if (!structuredData[area]) {
        structuredData[area] = {};
      }
      // Crear el objeto de Maquina (dentro de Area) si no existe
      if (!structuredData[area][maquina]) {
        structuredData[area][maquina] = [];
      }
      // Añadir la estacion a la maquina (evitando duplicados si los hay)
      if (!structuredData[area][maquina].includes(estacion)) {
        structuredData[area][maquina].push(estacion);
      }
    }

    // 3. Procesar Soluciones (Columna D)
    const soluciones = valueRanges[1]?.values?.flat().filter(Boolean) || [];

    // 4. Devolvemos todo como un solo objeto JSON
    return {
      statusCode: 200,
      body: JSON.stringify({
        data: structuredData,
        soluciones: soluciones,
      }),
    };

  } catch (error) {
    console.error('Error al leer la hoja de configuración:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'No se pudo cargar la configuración.' }),
    };
  }
};