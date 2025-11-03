const { google } = require('googleapis');

// --- Configuración de Autenticación ---
function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsAPI(auth) {
  return google.sheets({ version: 'v4', auth });
}

// --- Función para extraer la fila (LA DEJAMOS AUNQUE NO SE USE EN 'abrir') ---
function getRowFromRange(range) {
  const match = range.match(/!A(\d+):/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  const simpleMatch = range.match(/!A(\d+)/);
   if (simpleMatch && simpleMatch[1]) {
    return parseInt(simpleMatch[1], 10);
  }
  throw new Error('No se pudo extraer el número de fila del rango: ' + range);
}

// --- Handler Principal de Netlify ---
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { action, data, row } = JSON.parse(event.body);
    const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;

    if (!spreadsheetId) {
      throw new Error('El ID de la hoja de Mantenimiento no está configurado.');
    }

    const auth = getAuth();
    const sheets = getSheetsAPI(auth);

    // --- ACCIÓN 1: ABRIR REPORTE (MODIFICADA PARA LA PRUEBA) ---
    if (action === 'abrir') {
      
      // ****** INICIO DE LA MODIFICACIÓN ******
      // Simplemente escribimos, igual que en escribir-barras.js
      // No intentamos leer la respuesta ni devolver la fila.
      await sheets.spreadsheets.values.append({
        spreadsheetId: spreadsheetId,
        range: 'Hoja 1!A1',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [data],
        },
      });

      // Devolvemos un 'row' falso (ej: 99) para que el frontend
      // piense que funcionó y muestre la pantalla de Andon.
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Prueba de paro registrada.', row: 99 }),
      };
      // ****** FIN DE LA MODIFICACIÓN ******
    }
    
    // --- ACCIÓN 2: REGISTRAR LLEGADA DE MECÁNICO ---
    else if (action === 'llegada') {
      if (!row) throw new Error("Se requiere 'row' para la acción 'llegada'.");
      const updateRange = `Hoja 1!J${row}`; // Columna J
      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId,
        range: updateRange,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [data],
        },
      });
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Llegada registrada.' }),
      };
    }

    // --- ACCIÓN 3: CERRAR REPORTE (SOLUCIÓN) ---
    else if (action === 'cerrar') {
      if (!row) throw new Error("Se requiere 'row' para la acción 'cerrar'.");
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: spreadsheetId,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: [
            {
              range: `Hoja 1!H${row}:I${row}`,
              values: [[ data[0], data[1] ]]
            },
            {
              range: `Hoja 1!K${row}`,
              values: [[ data[2] ]]
            }
          ]
        }
      });
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Paro finalizado y actualizado.' }),
      };
    } 
    
    // --- Error si la acción no es válida ---
    else {
      throw new Error('Acción no válida. Debe ser "abrir", "llegada" o "cerrar".');
    }

  } catch (error) {
    console.error('Error en la función de Mantenimiento:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error al procesar la solicitud: ' + error.message }),
    };
  }
};