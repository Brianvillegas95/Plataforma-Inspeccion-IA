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
  const match = range.match(/!([A-Z]+)(\d+)/);
  if (match && match[2]) {
    return parseInt(match[2], 10);
  }
  throw new Error(`No se pudo extraer el número de fila del rango: ${range}`);
}

// --- Funciones de Ayuda para Mecánicos ---

// Busca un mecánico en MECANICOS_DB por su nombre
async function findMechanicByName(sheets, name) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:E',
  });
  const mechanics = response.data.values || [];
  for (let i = 0; i < mechanics.length; i++) {
    if (mechanics[i][0] === name) {
      return {
        row: i + 2, // Fila real
        name: mechanics[i][0],
        area: mechanics[i][1],
        availability: mechanics[i][2],
        status: mechanics[i][3],
        // === ¡ESTA ES LA CORRECCIÓN! ===
        TareaActual_RowID: mechanics[i][4] // Devolver Columna E
      };
    }
  }
  return null;
}

// Busca al primer mecánico libre Y disponible para un área
async function findFreeMechanic(sheets, area) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:E',
  });
  const mechanics = response.data.values || [];
  for (let i = 0; i < mechanics.length; i++) {
    const [name, assignedArea, availability, systemStatus] = mechanics[i];
    const isFree = (!systemStatus || systemStatus === 'Libre');
    if (assignedArea === area && availability === 'Disponible' && isFree) {
      return { row: i + 2, name: name, area: assignedArea };
    }
  }
  return null;
}

// Actualiza el estado de un mecánico en MECANICOS_DB
async function updateMechanicStatus(sheets, row, status, reportRowId) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!D${row}:E${row}`, // Col D (StatusSistema) y E (TareaActual_RowID)
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[status, reportRowId || '']],
    },
  });
}

// Actualiza la DISPONIBILIDAD de un mecánico (Login/Logout)
async function updateMechanicAvailability(sheets, name, availability) {
  const mechanic = await findMechanicByName(sheets, name);
  if (!mechanic) throw new Error(`Mecánico ${name} no encontrado en MECANICOS_DB.`);
  
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  let statusSistema = mechanic.status;

  if (availability === 'Disponible' && statusSistema !== 'Ocupado') {
      statusSistema = 'Libre';
  }
  if (availability === 'No Disponible') {
      statusSistema = 'Ocupado'; 
  }
  
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!C${mechanic.row}:D${mechanic.row}`, // Col C (Disponibilidad) y D (StatusSistema)
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[availability, statusSistema]],
    },
  });
  
  return mechanic;
}

// --- Funciones de Ayuda para Cola y Prioridad ---

async function findOldestPendingJob(sheets, area) {
  const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!C2:N', // C: Area, G: Status maquina, N: StatusParo
  });
  const jobs = response.data.values || [];

  let highPriorityJob = null;
  let lowPriorityJob = null;

  for (let i = 0; i < jobs.length; i++) {
    // Ajuste de índices: C=0, G=4, N=11 (en el rango C2:N)
    const jobArea = jobs[i][0]; // Col C
    const jobStatusMaquina = jobs[i][4]; // Col G
    const jobStatusParo = jobs[i][11]; // Col N

    if (jobArea === area && jobStatusParo === 'Abierto') {
      if (jobStatusMaquina === 'detenida' && !highPriorityJob) {
        highPriorityJob = { row: i + 2 };
        break; 
      }
      if (jobStatusMaquina === 'trabajando' && !lowPriorityJob) {
        lowPriorityJob = { row: i + 2 };
      }
    }
  }
  return highPriorityJob || lowPriorityJob;
}

async function assignPendingJob(sheets, mechanic, job) {
  console.log(`Asignación automática de cola: ${mechanic.name} -> Fila ${job.row}`);
  await updateMechanicStatus(sheets, mechanic.row, 'Ocupado', job.row);
  const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!M${job.row}:N${job.row}`, // Col M (MecanicoAsignado) y N (StatusParo)
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[mechanic.name, 'Asignado']],
    },
  });
}

async function releaseMechanicAndCheckQueue(sheets, mechanicName) {
  if (!mechanicName || mechanicName === 'En Espera') return;
  const mechanic = await findMechanicByName(sheets, mechanicName);
  if (!mechanic || mechanic.status === 'Libre') {
    console.log(`No se necesitó liberar a ${mechanicName}.`);
    return;
  }
  
  await updateMechanicStatus(sheets, mechanic.row, 'Libre', '');
  console.log(`Mecánico ${mechanicName} (${mechanic.area}) liberado.`);
  
  if (mechanic.availability === 'Disponible') {
    try {
      const pendingJob = await findOldestPendingJob(sheets, mechanic.area);
      if (pendingJob) {
        await assignPendingJob(sheets, mechanic, pendingJob);
      } else {
        console.log(`No hay trabajos pendientes para ${mechanic.area}.`);
      }
    } catch (e) {
      console.error("Error al re-asignar trabajo:", e.message);
    }
  } else {
    console.log(`Mecánico ${mechanicName} está "No Disponible" (logout), no se le asignan tareas.`);
  }
}

// --- Handler Principal ---
exports.handler = async function (event) {
  // ... (El resto del handler no cambia)
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  try {
    const { action, data, row, name } = JSON.parse(event.body);
    if (!action) {
       return { statusCode: 400, body: JSON.stringify({ error: 'Falta "action".' }) };
    }
    const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
    if (!produccionSheetId) {
      throw new Error('MANTENIMIENTO_SHEET_ID no está configurado.');
    }
    const auth = getAuth();
    const sheets = getSheetsAPI(auth);
    switch (action) {
      case 'abrir': {
        if (!data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "data".' }) };
        const now = new Date();
        const folio = `MAN-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
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
        const dataToWrite = [
          folio, ...data, '', '', '', '', mecanicName, statusParo
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
        if (assignedMechanic) {
          await updateMechanicStatus(sheets, assignedMechanic.row, 'Ocupado', newRow);
        }
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            row: newRow,
            status: statusParo, 
            mecanico: mecanicName,
            folio: folio
          }),
        };
      }
      case 'llegada': {
        if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "data".' }) };
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: produccionSheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
              { range: `Hoja 1!K${row}`, values: [data] },
              { range: `Hoja 1!N${row}`, values: [['En Proceso']] }
            ]
          }
        });
        return { statusCode: 200, body: JSON.stringify({ message: 'Llegada registrada.' }) };
      }
      case 'cerrar': {
        if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "data".' }) };
        const mecanicoQueCerro = data[1];
        let mecanicoAsignado = 'En Espera';
        try {
          const getResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: produccionSheetId,
            range: `Hoja 1!M${row}`,
          });
          if (getResponse.data.values) {
            mecanicoAsignado = getResponse.data.values[0][0];
          }
        } catch (e) { console.error("No se pudo leer el mecánico asignado.", e.message); }
        await releaseMechanicAndCheckQueue(sheets, mecanicoQueCerro);
        if (mecanicoAsignado !== 'En Espera' && mecanicoAsignado !== mecanicoQueCerro) {
          console.log(`Liberando también al mecánico asignado originalmente: ${mecanicoAsignado}`);
          await releaseMechanicAndCheckQueue(sheets, mecanicoAsignado);
        }
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: produccionSheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
              { range: `Hoja 1!I${row}:J${row}`, values: [[ data[0], data[1] ]] },
              { range: `Hoja 1!L${row}`, values: [[ data[2] ]] },
              { range: `Hoja 1!N${row}`, values: [['Cerrado']] }
            ]
          }
        });
        return { statusCode: 200, body: JSON.stringify({ message: 'Paro finalizado.' }) };
      }
      case 'check_status': {
        if (!row) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row".' }) };
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: produccionSheetId,
          range: `Hoja 1!M${row}:N${row}`,
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
      case 'mecanico_check_in': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        const mechanic = await updateMechanicAvailability(sheets, name, 'Disponible');
        const pendingJob = await findOldestPendingJob(sheets, mechanic.area);
        if (pendingJob) {
          await assignPendingJob(sheets, mechanic, pendingJob);
        }
        return { statusCode: 200, body: JSON.stringify({ message: `Mecánico ${name} check-in.` }) };
      }
      case 'mecanico_check_out': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        await updateMechanicAvailability(sheets, name, 'No Disponible');
        return { statusCode: 200, body: JSON.stringify({ message: `Mecánico ${name} check-out.` }) };
      }
      // --- Acción: OBTENER TAREAS DE MECÁNICO (Corregida) ---
      case 'get_mecanico_tareas': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        // La función 'findMechanicByName' AHORA SÍ devuelve TareaActual_RowID
        const mechanic = await findMechanicByName(sheets, name);
        if (!mechanic) return { statusCode: 404, body: JSON.stringify({ error: 'Mecánico no encontrado.' }) };

        let tareaActual = null;
        const tareasEnCola = [];
        
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: produccionSheetId,
          range: 'Hoja 1!A2:N',
        });
        const jobs = response.data.values || [];
        
        for (let i = 0; i < jobs.length; i++) {
          const row = i + 2;
          const [folio, , area, maquina, estacion, , , , , , , , mecanicoAsignado, statusParo] = jobs[i];
          
          if (mecanicoAsignado === name && (statusParo === 'Asignado' || statusParo === 'En Proceso')) {
            const tarea = { folio, area, maquina, estacion, statusParo };
            
            // --- Lógica de Tarea Actual (Corregida) ---
            // 'mechanic.TareaActual_RowID' ahora tiene valor
            if (statusParo === 'En Proceso' || String(row) === String(mechanic.TareaActual_RowID)) {
              tareaActual = tarea;
            } else {
              tareasEnCola.push(tarea);
            }
          }
        }
        return { statusCode: 200, body: JSON.stringify({ tareaActual, tareasEnCola }) };
      }
      default:
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