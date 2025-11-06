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

// --- Funciones de Ayuda para Mecánicos (Actualizadas) ---

async function findFreeMechanic(sheets, area) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  if (!spreadsheetId) throw new Error('MECANICOS_SHEET_ID no está configurado.');

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:E',
  });

  const mechanics = response.data.values || [];
  
  for (let i = 0; i < mechanics.length; i++) {
    const [name, assignedArea, availability, systemStatus] = mechanics[i];
    const isFree = (!systemStatus || systemStatus === 'Libre');

    if (assignedArea === area && availability === 'Disponible' && isFree) {
      return {
        row: i + 2,
        name: name,
        area: assignedArea
      };
    }
  }
  return null;
}

async function updateMechanicStatus(sheets, row, status, reportRowId) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!D${row}:E${row}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[status, reportRowId || '']],
    },
  });
}

// --- NUEVA FUNCIÓN DE AYUDA ---
/**
 * Busca el paro "Abierto" más antiguo (primero en la hoja) para un área específica.
 */
async function findOldestPendingJob(sheets, area) {
  const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
  
  // Leemos las columnas Area (B) y StatusParo (M)
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!B2:M', 
  });

  const jobs = response.data.values || [];

  for (let i = 0; i < jobs.length; i++) {
    const jobArea = jobs[i][0]; // Col B
    const jobStatus = jobs[i][11]; // Col M (B es 0, M es 11)
    
    // Si el área coincide y el status es "Abierto"
    if (jobArea === area && jobStatus === 'Abierto') {
      return {
        row: i + 2, // Fila real (A2 es fila 2)
      };
    }
  }
  return null; // No hay trabajos pendientes para esa área
}

// --- NUEVA FUNCIÓN DE AYUDA ---
/**
 * Asigna un mecánico a un trabajo pendiente.
 */
async function assignPendingJob(sheets, mechanic, job) {
  console.log(`Asignación automática: ${mechanic.name} -> Fila ${job.row}`);
  
  // 1. Poner al mecánico como Ocupado
  await updateMechanicStatus(sheets, mechanic.row, 'Ocupado', job.row);
  
  // 2. Actualizar el paro a "Asignado"
  const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!L${job.row}:M${job.row}`, // Col L (MecanicoAsignado) y M (StatusParo)
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[mechanic.name, 'Asignado']],
    },
  });
}

/**
 * Libera a un mecánico Y activa la búsqueda de cola.
 */
async function releaseMechanicAndCheckQueue(sheets, mechanicName) {
  if (!mechanicName || mechanicName === 'En Espera') return;

  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:D',
  });

  const mechanics = response.data.values || [];
  
  for (let i = 0; i < mechanics.length; i++) {
    const name = mechanics[i][0];
    const area = mechanics[i][1];
    const systemStatus = mechanics[i][3];
    
    if (name === mechanicName && systemStatus === 'Ocupado') {
      const rowToUpdate = i + 2;
      
      // 1. Liberar al mecánico
      await updateMechanicStatus(sheets, rowToUpdate, 'Libre', '');
      console.log(`Mecánico ${name} liberado.`);
      
      // 2. ¡NUEVO! Buscar en la cola de esa área
      try {
        const pendingJob = await findOldestPendingJob(sheets, area);
        if (pendingJob) {
          // Encontramos un trabajo. Volvemos a asignar al mecánico.
          // (Usamos los datos que ya tenemos: rowToUpdate, name, area)
          await assignPendingJob(sheets, { row: rowToUpdate, name: name, area: area }, pendingJob);
        } else {
          // No hay trabajos, el mecánico queda libre.
          console.log(`No hay trabajos pendientes para ${area}.`);
        }
      } catch (e) {
        console.error("Error al re-asignar trabajo:", e.message);
      }
      return;
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

    // --- ACCIÓN: ABRIR REPORTE (Sin cambios) ---
    if (action === 'abrir') {
      // ... (El código de 'abrir' no necesita cambios)
      if (!data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "data".' }) };
      const areaDelParo = data[1]; 
      let assignedMechanic = null;
      let statusParo = 'Abierto';
      let mecanicName = 'En Espera';
      try {
        assignedMechanic = await findFreeMechanic(sheets, areaDelParo);
      } catch (mechError) {
        console.error("Error buscando mecánico:", mechError.message);
      }
      if (assignedMechanic) {
        statusParo = 'Asignado';
        mecanicName = assignedMechanic.name;
        console.log(`Asignando a ${mecanicName} (fila ${assignedMechanic.row})`);
      } else {
        console.log("No se encontraron mecánicos disponibles.");
      }
      const dataToWrite = [...data,'','','','',mecanicName,statusParo];
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
      if (assignedMechanic) {
        await updateMechanicStatus(sheets, assignedMechanic.row, 'Ocupado', newRow);
      }
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'Paro registrado.', 
          row: newRow,
          status: statusParo, 
          mecanico: mecanicName
        }),
      };
    }
    
    // --- ACCIÓN: REGISTRAR LLEGADA (Sin cambios) ---
    else if (action === 'llegada') {
      // ... (El código de 'llegada' no necesita cambios)
      if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "data".' }) };
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: produccionSheetId,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: [
            { range: `Hoja 1!J${row}`, values: [data] },
            { range: `Hoja 1!M${row}`, values: [['En Proceso']] }
          ]
        }
      });
      return { statusCode: 200, body: JSON.stringify({ message: 'Llegada registrada.' }) };
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
        console.error("No se pudo leer el mecánico asignado.", e.message);
      }

      // 2. Liberar al mecánico que CERRÓ el ticket (y revisar cola)
      //    Usamos la nueva función
      await releaseMechanicAndCheckQueue(sheets, mecanicoQueCerro);
      
      // 3. Si el asignado era OTRA persona, liberarlo también (y revisar cola)
      if (mecanicoAsignado !== 'En Espera' && mecanicoAsignado !== mecanicoQueCerro) {
        console.log(`Liberando también al mecánico asignado originalmente: ${mecanicoAsignado}`);
        await releaseMechanicAndCheckQueue(sheets, mecanicoAsignado);
      }
      
      // 4. Actualizar la hoja de MANTENIMIENTO-PRODUCCION con los datos de cierre
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: produccionSheetId,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: [
            { range: `Hoja 1!H${row}:I${row}`, values: [[ data[0], data[1] ]] },
            { range: `Hoja 1!K${row}`, values: [[ data[2] ]] },
            { range: `Hoja 1!M${row}`, values: [['Cerrado']] }
          ]
        }
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Paro finalizado y actualizado.' }),
      };
    }
    
    // --- ¡NUEVA ACCIÓN! ---
    // Esta acción solo comprueba el estado de un paro
    else if (action === 'check_status') {
      if (!row) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row".' }) };

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: produccionSheetId,
        range: `Hoja 1!L${row}:M${row}`, // Leer MecanicoAsignado y StatusParo
      });

      if (!response.data.values || !response.data.values[0]) {
        throw new Error(`No se encontraron datos para la fila ${row}`);
      }
      
      const [mecanico, status] = response.data.values[0];
      
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          mecanico: mecanico || 'En Espera',
          status: status || 'Abierto'
        }),
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