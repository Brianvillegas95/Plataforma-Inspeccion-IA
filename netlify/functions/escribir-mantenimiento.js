const { google } = require('googleapis');

// --- Configuración de Autenticación (Sin cambios) ---
function getAuth() {
  const credentials = {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Error de configuración: Faltan credenciales.');
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsAPI(auth) {
  return google.sheets({ version: 'v4', auth });
}

function getRowFromRange(range) {
  if (!range) throw new Error('No se recibió un rango de la API de Google.');
  const match = range.match(/!A(\d+):/);
  if (match && match[1]) return parseInt(match[1], 10);
  const simpleMatch = range.match(/!A(\d+)/);
  if (simpleMatch && simpleMatch[1]) return parseInt(simpleMatch[1], 10);
  throw new Error(`No se pudo extraer el número de fila del rango: ${range}`);
}

// --- NUEVO: Funciones de Ayuda para Mecánicos ---

/**
 * Busca al primer mecánico disponible que cumpla con los criterios.
 */
async function findFreeMechanic(sheets, area) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  if (!spreadsheetId) throw new Error('MECANICOS_SHEET_ID no está configurado.');

  // Leemos toda la hoja de mecánicos
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:E', // Nombre, Area, Disponibilidad, StatusSistema, TareaActual
  });

  const mechanics = response.data.values || [];
  
  for (let i = 0; i < mechanics.length; i++) {
    const [name, assignedArea, availability, systemStatus] = mechanics[i];
    
    // === ¡CAMBIO AQUÍ! ===
    // Ahora aceptamos 'Libre' O una celda vacía (!systemStatus)
    const isFree = (!systemStatus || systemStatus === 'Libre');

    // El mecánico debe cumplir las 3 condiciones
    if (assignedArea === area && 
        availability === 'Disponible' && 
        isFree) {
      
      return {
        row: i + 2, // Fila real en la hoja (A2 es la fila 2)
        name: name,
      };
    }
  }
  return null; // No se encontró a nadie
}

/**
 * Actualiza el estado de un mecánico en MECANICOS_DB.
 */
async function updateMechanicStatus(sheets, row, status, reportRowId) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!D${row}:E${row}`, // Col D (StatusSistema) y E (TareaActual_RowID)
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[status, reportRowId || '']], // Si liberamos, borramos el RowID
    },
  });
}

/**
 * Libera a un mecánico por su nombre (lo busca y lo pone como "Libre").
 */
async function releaseMechanic(sheets, mechanicName) {
  if (!mechanicName || mechanicName === 'En Espera') return; // No hacer nada si no hay nombre

  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:D', // Nombre, Area, Disp, Status
  });

  const mechanics = response.data.values || [];
  
  for (let i = 0; i < mechanics.length; i++) {
    const name = mechanics[i][0];
    const systemStatus = mechanics[i][3];
    
    // Encontramos al mecánico Y está ocupado
    if (name === mechanicName && systemStatus === 'Ocupado') {
      const rowToUpdate = i + 2; // Fila real
      await updateMechanicStatus(sheets, rowToUpdate, 'Libre', ''); // Poner como Libre y borrar RowID
      console.log(`Mecánico ${mechanicName} liberado.`);
      return; // Salir de la función
    }
  }
  console.log(`No se necesitó liberar a ${mechanicName} (ya estaba libre o no se encontró).`);
}

// --- Handler Principal (Actualizado) ---

exports.handler = async function (event) {
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { action, data, row } = JSON.parse(event.body);

    if (!action) {
       return { statusCode: 400, body: JSON.stringify({ error: 'Falta "action".' }) };
    }

    const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
    if (!produccionSheetId) {
      throw new Error('MANTENIMIENTO_SHEET_ID no está configurado.');
    }

    const auth = getAuth();
    const sheets = getSheetsAPI(auth);

    // --- ACCIÓN: ABRIR REPORTE (Actualizada) ---
    if (action === 'abrir') {
      if (!data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "data".' }) };

      const areaDelParo = data[1]; // data = [fecha, area, maquina, ...]
      let assignedMechanic = null;
      let statusParo = 'Abierto';
      let mecanicName = 'En Espera';

      try {
        assignedMechanic = await findFreeMechanic(sheets, areaDelParo);
      } catch (mechError) {
        console.error("Error buscando mecánico:", mechError.message);
        // Continuamos sin asignar, pero registramos el error
      }

      if (assignedMechanic) {
        statusParo = 'Asignado';
        mecanicName = assignedMechanic.name;
        console.log(`Asignando a ${mecanicName} (fila ${assignedMechanic.row})`);
      } else {
        console.log("No se encontraron mecánicos disponibles.");
      }
      
      // Añadimos los nuevos datos al array que se escribirá en la hoja
      const dataToWrite = [
        ...data,         // data[0] a data[6] (fechaApertura... workOrder)
        '',              // Col H (Solucion) - vacía
        '',              // Col I (Mecanico) - vacía
        '',              // Col J (Fecha Llegada) - vacía
        '',              // Col K (Fecha Cierre) - vacía
        mecanicName,     // Col L (MecanicoAsignado) - ¡NUEVO!
        statusParo       // Col M (StatusParo) - ¡NUEVO!
      ];

      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: produccionSheetId,
        range: 'Hoja 1!A1',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [dataToWrite],
        },
      });
      
      const updatedRange = response.data.updates.updatedRange;
      const newRow = getRowFromRange(updatedRange);
      
      // Si asignamos un mecánico, actualizamos MECANICOS_DB
      if (assignedMechanic) {
        await updateMechanicStatus(sheets, assignedMechanic.row, 'Ocupado', newRow);
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'Paro registrado.', 
          row: newRow,
          status: statusParo, // 'Asignado' o 'Abierto'
          mecanico: mecanicName // Nombre o 'En Espera'
        }),
      };
    }
    
    // --- ACCIÓN: REGISTRAR LLEGADA (Actualizada) ---
    else if (action === 'llegada') {
      if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "data".' }) };
      
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: produccionSheetId,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: [
            {
              range: `Hoja 1!J${row}`, // Col J (Fecha Llegada)
              values: [data] // data es [fechaLlegada]
            },
            {
              range: `Hoja 1!M${row}`, // Col M (StatusParo)
              values: [['En Proceso']]
            }
          ]
        }
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Llegada registrada.' }),
      };
    }

    // --- ACCIÓN: CERRAR REPORTE (Actualizada) ---
    else if (action === 'cerrar') {
      if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "data".' }) };
      
      const mecanicoQueCerro = data[1]; // data = [solucion, mecanico, fechaCierre]

      // 1. Leer quién estaba asignado originalmente (Col L)
      let mecanicoAsignado = 'En Espera';
      try {
        const getResponse = await sheets.spreadsheets.values.get({
          spreadsheetId: produccionSheetId,
          range: `Hoja 1!L${row}`,
        });
        if (getResponse.data.values) {
          mecanicoAsignado = getResponse.data.values[0][0];
        }
      } catch (e) {
        console.error("No se pudo leer el mecánico asignado, se liberará solo al que cerró.", e.message);
      }

      // 2. Liberar al mecánico que CERRÓ el ticket
      await releaseMechanic(sheets, mecanicoQueCerro);
      
      // 3. Si el asignado era OTRA persona, liberarlo también
      if (mecanicoAsignado !== 'En Espera' && mecanicoAsignado !== mecanicoQueCerro) {
        console.log(`Liberando también al mecánico asignado originalmente: ${mecanicoAsignado}`);
        await releaseMechanic(sheets, mecanicoAsignado);
      }
      
      // 4. Actualizar la hoja de MANTENIMIENTO-PRODUCCION con los datos de cierre
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: produccionSheetId,
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
            },
            {
              range: `Hoja 1!M${row}`, // StatusParo
              values: [['Cerrado']]
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
      return { statusCode: 400, body: JSON.stringify({ error: `Acción desconocida: "${action}".` }) };
    }

  } catch (error) {
    console.error('Error fatal en la función:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error al procesar la solicitud: ' + error.message }),
    };
  }
};