const { google } = require('googleapis');

/**
 * Crea y configura un cliente de autenticación de Google.
 * Las credenciales se leen desde las variables de entorno.
 */
function getAuth() {
  const credentials = {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };

  if (!credentials.client_email || !credentials.private_key) {
    console.error('Error: Faltan credenciales de la cuenta de servicio en las variables de entorno.');
    throw new Error('Error de configuración del servidor: credenciales incompletas.');
  }
  
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

/**
 * Crea una instancia de la API de Google Sheets.
 */
function getSheetsAPI(auth) {
  return google.sheets({ version: 'v4', auth });
}

/**
 * Extrae el número de fila (como entero) de un rango de A1Notation.
 * Ejemplo: 'Hoja 1!A5:G5' devuelve 5.
 */
function getRowFromRange(range) {
  if (!range) {
    throw new Error('No se recibió un rango de la API de Google.');
  }
  
  // Intenta encontrar un rango como 'A5:G5'
  const match = range.match(/!A(\d+):/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  
  // Si falla, intenta encontrar un rango simple como 'A5'
  const simpleMatch = range.match(/!A(\d+)/);
   if (simpleMatch && simpleMatch[1]) {
    return parseInt(simpleMatch[1], 10);
  }
  
  throw new Error(`No se pudo extraer el número de fila del rango: ${range}`);
}

// --- Handler Principal de Netlify ---
exports.handler = async function (event) {
  
  // 1. Validar Método HTTP
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ error: 'Method Not Allowed' }) 
    };
  }

  try {
    // 2. Validar Cuerpo de la Solicitud
    if (!event.body) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: 'No se recibió cuerpo en la solicitud.' }) 
      };
    }
    
    const { action, data, row } = JSON.parse(event.body);

    if (!action || !data) {
       return { 
         statusCode: 400, 
         body: JSON.stringify({ error: 'Faltan parámetros "action" o "data" en la solicitud.' }) 
       };
    }

    // 3. Validar Variables de Entorno
    const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
    if (!spreadsheetId) {
      console.error('Error: MANTENIMIENTO_SHEET_ID no está configurado en Netlify.');
      return { 
        statusCode: 500, 
        body: JSON.stringify({ error: 'Error de configuración: falta el ID de la hoja.' }) 
      };
    }

    // 4. Autenticar e Iniciar API
    const auth = getAuth();
    const sheets = getSheetsAPI(auth);

    // 5. Ejecutar acciones basadas en la solicitud
    
    // --- ACCIÓN: ABRIR REPORTE ---
    if (action === 'abrir') {
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: spreadsheetId,
        range: 'Hoja 1!A1',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [data], // data = [fecha, area, maquina, estacion, ...]
        },
      });

      // **Validación de Buena Práctica**
      // Asegurarse de que Google devolvió la respuesta que esperamos
      if (!response || !response.data || !response.data.updates || !response.data.updates.updatedRange) {
        console.error('Error: La API de Google no devolvió un "updatedRange" después de append.', response);
        throw new Error('La API de Google guardó los datos, pero no devolvió el rango actualizado.');
      }

      const updatedRange = response.data.updates.updatedRange;
      const newRow = getRowFromRange(updatedRange);

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Paro registrado con éxito.', row: newRow }),
      };
    }
    
    // --- ACCIÓN: REGISTRAR LLEGADA ---
    else if (action === 'llegada') {
      if (!row) {
         return { 
           statusCode: 400, 
           body: JSON.stringify({ error: 'Se requiere el número de "row" para la acción "llegada".' }) 
         };
      }
      
      const updateRange = `Hoja 1!J${row}`; // Columna J
      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId,
        range: updateRange,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [data], // data es [fechaLlegada]
        },
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Llegada registrada.' }),
      };
    }

    // --- ACCIÓN: CERRAR REPORTE ---
    else if (action === 'cerrar') {
      if (!row) {
        return { 
          statusCode: 400, 
          body: JSON.stringify({ error: 'Se requiere el número de "row" para la acción "cerrar".' }) 
        };
      }
      
      // data = [solucion, mecanico, fechaCierre]
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: spreadsheetId,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: [
            {
              range: `Hoja 1!H${row}:I${row}`, // Solucion, Mecanico
              values: [[ data[0], data[1] ]] 
            },
            {
              range: `Hoja 1!K${row}`, // Fecha Cierre
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
    
    // --- ACCIÓN DESCONOCIDA ---
    else {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: `Acción desconocida: "${action}".` }) 
      };
    }

  } catch (error) {
    // Captura cualquier error (de API, de credenciales, de lógica)
    console.error('Error fatal en la función de Mantenimiento:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error al procesar la solicitud: ' + error.message }),
    };
  }
};