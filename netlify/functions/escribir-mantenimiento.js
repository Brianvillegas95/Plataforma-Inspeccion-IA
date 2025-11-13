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

// --- Funciones de Ayuda para Mecánicos (Actualizadas) ---

/**
 * Función simple: Solo lee lo que está en MECANICOS_DB
 */
async function findMechanicByName(sheets, name) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const mecsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:E',
  });
  const mechanics = mecsResponse.data.values || [];
  for (let i = 0; i < mechanics.length; i++) {
    if (mechanics[i][0] === name) {
      return {
        row: i + 2, name: mechanics[i][0], area: mechanics[i][1],
        availability: mechanics[i][2], 
        status: mechanics[i][3], // Estado actual en la DB
        TareaActual_RowID: mechanics[i][4] // RowID actual en la DB
      };
    }
  }
  return null;
}

/**
 * Revisa si un mecánico tiene trabajo ACTIVO
 */
async function findMechanicActiveJob(sheets, name) {
    const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
    const jobsResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: produccionSheetId,
        range: 'Hoja 1!M2:N', // Col M (MecanicoAsignado), Col N (StatusParo)
    });
    const jobs = jobsResponse.data.values || [];
    for (let i = 0; i < jobs.length; i++) {
        const mecanicoAsignado = jobs[i][0]; // Col M
        const statusParo = jobs[i][1]; // Col N
        if (mecanicoAsignado === name && (statusParo === 'En Proceso' || statusParo === 'Asignado')) {
            return { row: i + 2, status: statusParo }; // Devuelve el trabajo activo
        }
    }
    return null; // No tiene trabajo activo
}

/**
 * // MEJORA: Esta función es clave para el balanceo.
 * Cuenta cuántos trabajos "En Cola" tiene CADA mecánico.
 */
async function getMechanicQueueCounts(sheets) {
    const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: produccionSheetId,
        range: 'Hoja 1!M2:N', 
    });
    const jobs = response.data.values || [];
    const queueCounts = {};

    for (const [mecanico, status] of jobs) {
        if (mecanico && status === 'En Cola') {
            queueCounts[mecanico] = (queueCounts[mecanico] || 0) + 1;
        }
    }
    return queueCounts;
}

/**
 * // MEJORA: Esta es la lógica de BALANCEO DE CARGA para 2+ mecánicos.
 * Encuentra a quién asignar (Balanceo de Carga).
 * 1. Busca un mecánico 'Libre' en el área.
 * 2. Si no hay, busca al mecánico 'Ocupado' (pero Disponible) con la cola MÁS CORTA.
 */
async function findMechanicToAssign(sheets, area) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const mecsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:E',
  });
  const mechanics = mecsResponse.data.values || [];
  // Obtiene la cuenta de cola de TODOS
  const queueCounts = await getMechanicQueueCounts(sheets);

  let freeMechanic = null;
  let bestBusyMechanic = null;
  let minQueueCount = Infinity;

  for (let i = 0; i < mechanics.length; i++) {
    const [name, assignedArea, availability, systemStatus] = mechanics[i];
    
    // Solo considera mecánicos del área y que estén 'Disponibles' (logueados)
    if (assignedArea === area && availability === 'Disponible') {
        const isFree = (!systemStatus || systemStatus === 'Libre');
        
        // 1. Si está 'Libre', es la mejor opción. Lo asigna y termina.
        if (isFree) {
            freeMechanic = { row: i + 2, name: name, area: assignedArea, status: 'Libre' };
            break; 
        }

        // 2. Si está 'Ocupado', revisa su cola.
        if (systemStatus === 'Ocupado') {
            const currentQueueCount = queueCounts[name] || 0;
            // Si este mecánico ocupado tiene menos cola que el anterior, es el nuevo "mejor"
            if (currentQueueCount < minQueueCount) {
                minQueueCount = currentQueueCount;
                bestBusyMechanic = { row: i + 2, name: name, area: assignedArea, status: 'Ocupado' };
            }
        }
    }
  }
  // Devuelve al libre, o si no hay, al ocupado con menos cola.
  return freeMechanic || bestBusyMechanic || null;
}

async function updateMechanicStatus(sheets, row, status, reportRowId) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!D${row}:E${row}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[status, reportRowId || '']], // Borrar RowID si está vacío
    },
  });
}

// Actualiza Disponibilidad (Sincronizado)
async function updateMechanicAvailability(sheets, name, availability) {
  const mechanic = await findMechanicByName(sheets, name); 
  if (!mechanic) throw new Error(`Mecánico ${name} no encontrado en MECANICOS_DB.`);
  
  // Sincronizar estado ANTES de decidir
  const activeJob = await findMechanicActiveJob(sheets, name);
  let newStatusSistema = 'Ocupado'; // Asumir ocupado

  if (availability === 'Disponible') {
      if (activeJob) {
          newStatusSistema = 'Ocupado'; // Tiene trabajo, está ocupado
      } else {
          newStatusSistema = 'Libre'; // No tiene trabajo, está libre
      }
  }
  // Si es 'No Disponible', siempre es 'Ocupado' (para el sistema)
  
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!C${mechanic.row}:D${mechanic.row}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[availability, newStatusSistema]],
    },
  });
  
  mechanic.status = newStatusSistema; // Devolver el estado REAL (sincronizado)
  return mechanic;
}

// --- Lógica de "Cola Compartida" (WMS) ---

/**
 * // MEJORA: Esta es la lógica de "COLA COMPARTIDA" (Pull System).
 * Busca el *próximo trabajo* en el área, sin importar de quién era.
 * Prioritiza 'detenida' sobre 'trabajando'.
 */
async function findNextJobInSharedQueue(sheets, mechanicArea) {
  const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!C2:N', 
  });
  const jobs = response.data.values || [];

  let highPriorityJob = null;
  let lowPriorityJob = null;

  for (let i = 0; i < jobs.length; i++) {
    const row = i + 2;
    const jobArea = jobs[i][0]; // Col C
    const jobStatusMaquina = jobs[i][4]; // Col G
    const jobStatusParo = jobs[i][11]; // Col N

    if (jobArea === mechanicArea && jobStatusParo === 'En Cola') {
      // 1. El primer trabajo de alta prioridad que encuentra, lo toma y sale.
      if (jobStatusMaquina === 'detenida' && !highPriorityJob) {
        highPriorityJob = { row: row };
        break; 
      }
      // 2. Si no, guarda el primer trabajo de baja prioridad que encuentra.
      if (jobStatusMaquina === 'trabajando' && !lowPriorityJob) {
        lowPriorityJob = { row: row };
      }
    }
  }
  // Devuelve el de alta prioridad, o si no, el de baja.
  return highPriorityJob || lowPriorityJob;
}

/**
 * // MEJORA: Esta función "toma" un trabajo de la cola compartida.
 * 1. Actualiza al mecánico a 'Ocupado' con el NUEVO RowID.
 * 2. Actualiza el reporte a 'Asignado' con el nombre del mecánico.
 */
async function reAssignPendingJob(sheets, mechanic, jobRow) {
  console.log(`RE-ASIGNACIÓN dinámica: ${mechanic.name} -> Fila ${jobRow}`);
  
  // 1. Pone al mecánico 'Ocupado' y le asigna el ID de la fila
  await updateMechanicStatus(sheets, mechanic.row, 'Ocupado', jobRow);
  
  const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
  // 2. Asigna el trabajo al mecánico
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!M${jobRow}:N${jobRow}`, 
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[mechanic.name, 'Asignado']], 
    },
  });
}

/**
 * // MEJORA: ¡AQUÍ ESTÁ LA CORRECCIÓN DE TU BUG!
 * Libera a un mecánico Y activa la "Cola Compartida".
 */
async function releaseMechanicAndCheckQueue(sheets, mechanicName) {
  if (!mechanicName || mechanicName === 'En Espera') return;
  
  // 1. Obtener los datos del mecánico (fila, área)
  const mechanic = await findMechanicByName(sheets, mechanicName); 
  if (!mechanic) {
      console.log(`Mecánico ${mechanicName} no encontrado.`);
      return;
  }
  
  // 2. Buscar si hay trabajo "En Cola" en su ÁREA (de cualquier mecánico)
  const nextJob = await findNextJobInSharedQueue(sheets, mechanic.area);
  
  if (nextJob) {
      // 3a. ¡Hay trabajo! RE-ASIGNARLO a este mecánico.
      // (Esta función lo pone "Ocupado" y actualiza el RowID a nextJob.row)
      console.log(`Mecánico ${mechanicName} liberado, RE-ASIGNANDO trabajo (Fila ${nextJob.row}).`);
      await reAssignPendingJob(sheets, mechanic, nextJob.row);
  } else {
      // 3b. No hay cola. Ponerlo "Libre" Y BORRAR EL ROWID.
      // Esta es la línea que arregla el bug del mecánico "atorado".
      console.log(`Mecánico ${mechanicName} liberado. No hay trabajos en cola.`);
      await updateMechanicStatus(sheets, mechanic.row, 'Libre', ''); // <-- ¡ESTO ARREGLA EL BUG!
  }
}

// --- Handler Principal ---
exports.handler = async function (event) {
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
      // --- Acción: ABRIR REPORTE (Usa Balanceo de Carga) ---
      case 'abrir': {
        if (!data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "data".' }) };
        const now = new Date();
        const folio = `MAN-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        const areaDelParo = data[1];

        // MEJORA: Llama a la lógica de balanceo de carga
        const mechanicToAssign = await findMechanicToAssign(sheets, areaDelParo);
        
        if (!mechanicToAssign) {
            return { statusCode: 503, body: JSON.stringify({ error: 'No hay mecánicos disponibles (logueados) para esta área.' }) };
        }
        
        let statusParo;
        if (mechanicToAssign.status === 'Libre') {
            statusParo = 'Asignado'; // Se asigna directo
            console.log(`Asignando a ${mechanicToAssign.name} (está Libre)`);
        } else {
            statusParo = 'En Cola'; // Se asigna al ocupado con menos cola
            console.log(`Asignando a ${mechanicToAssign.name} (está Ocupado, tiene la cola más corta)`);
        }

        const dataToWrite = [ folio, ...data, '', '', '', '', mechanicToAssign.name, statusParo ];
        
        const response = await sheets.spreadsheets.values.append({
          spreadsheetId: produccionSheetId,
          range: 'Hoja 1!A1',
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [dataToWrite] },
        });

        const newRow = getRowFromRange(response.data.updates.updatedRange);
        
        // Si se asignó a un mecánico Libre, hay que ponerlo 'Ocupado' y darle el RowID
        if (mechanicToAssign.status === 'Libre') {
            await updateMechanicStatus(sheets, mechanicToAssign.row, 'Ocupado', newRow);
        }
        
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            row: newRow, status: statusParo, mecanico: mechanicToAssign.name, folio: folio
          }),
        };
      }
      
      // --- Acción: CERRAR REPORTE (Usa Cola Compartida) ---
      case 'cerrar': {
        if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "data".' }) };
        const mecanicoQueCerro = data[1]; // Nombre del mecánico
        
        // PASO 1: Marcar el trabajo como "Cerrado"
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: produccionSheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
              { range: `Hoja 1!I${row}:J${row}`, values: [[ data[0], data[1] ]] }, // Solución y Mecánico
              { range: `Hoja 1!L${row}`, values: [[ data[2] ]] }, // Fecha Cierre
              { range: `Hoja 1!N${row}`, values: [['Cerrado']] } // Status
            ]
          }
        });

        // PASO 2: MEJORA: Libera al mecánico y activa la "Cola Compartida".
        // Esta función buscará un nuevo trabajo "En Cola" para él.
        // Si no encuentra, limpiará su RowID (el arreglo del bug).
        await releaseMechanicAndCheckQueue(sheets, mecanicoQueCerro);
        
        return { statusCode: 200, body: JSON.stringify({ message: 'Paro finalizado.' }) };
      }
      
      // --- Acción: LOGIN DE MECÁNICO (Usa Cola Compartida) ---
      case 'mecanico_check_in': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        
        // Esta función pone al mec. 'Disponible' y sincroniza su estado (Libre/Ocupado)
        const mechanic = await updateMechanicAvailability(sheets, name, 'Disponible');
        
        // MEJORA: Si el mecánico hace login y está 'Libre' (sin trabajos activos)...
        if (mechanic.status === 'Libre') {
            // ...inmediatamente busca trabajo en la COLA COMPARTIDA de su área.
            console.log(`Mecánico ${name} está libre, buscando trabajo en COLA COMPARTIDA...`);
            const nextJob = await findNextJobInSharedQueue(sheets, mechanic.area);
            if (nextJob) {
                // Si encuentra, se lo auto-asigna.
                await reAssignPendingJob(sheets, mechanic, nextJob.row);
            }
        }
        return { statusCode: 200, body: JSON.stringify({ message: `Mecánico ${name} check-in.` }) };
      }

      // --- Acción: LOGOUT DE MECÁNICO ---
      case 'mecanico_check_out': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        // Simplemente lo pone como 'No Disponible'
        await updateMechanicAvailability(sheets, name, 'No Disponible');
        return { statusCode: 200, body: JSON.stringify({ message: `Mecánico ${name} check-out.` }) };
      }
      
      // --- Acción: LLEGADA A MÁQUINA (Sin cambios de lógica) ---
      case 'llegada': {
        if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "data".' }) };
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: produccionSheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
              { range: `Hoja 1!K${row}`, values: [data] }, // Fecha Llegada
              { range: `Hoja 1!N${row}`, values: [['En Proceso']] } // Status
            ]
          }
        });
        return { statusCode: 200, body: JSON.stringify({ message: 'Llegada registrada.' }) };
      }

      // --- Acción: REVISAR ESTADO (Para Andon) (Sin cambios de lógica) ---
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
            mecanico: mecanico || 'N/A',
            status: status || 'Abierto' 
          }),
        };
      }
      
      // --- Acción: OBTENER TAREAS (Para App de Mecánico) (Lógica correcta) ---
      case 'get_mecanico_tareas': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        
        // No necesitamos findMechanicByName, solo buscar en la hoja de MANTENIMIENTO
        let tareaActual = null;
        const tareasEnCola = [];
        
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: produccionSheetId,
          range: 'Hoja 1!A2:N', // Lee toda la hoja de trabajos
        });
        const jobs = response.data.values || [];
        
        for (let i = 0; i < jobs.length; i++) {
            const [folio, , area, maquina, estacion, , statusMaquina, , , , , , mecanicoAsignado, statusParo] = jobs[i];
            
            // Si el trabajo es de este mecánico
            if (mecanicoAsignado === name) {
                const tarea = { folio, area, maquina, estacion, statusParo, statusMaquina };
                
                // 1. Si está 'En Proceso', es la tarea actual.
                if (statusParo === 'En Proceso') {
                    tareaActual = tarea;
                }
                // 2. Si está 'Asignado'...
                else if (statusParo === 'Asignado') {
                    if (!tareaActual) {
                         // ...y no hay nada 'En Proceso', es la tarea actual.
                         tareaActual = tarea;
                    } else {
                         // ...si ya hay una 'En Proceso', esta 'Asignada' va a la cola.
                         tareasEnCola.push(tarea);
                    }
                }
                // 3. Si está 'En Cola', siempre va a la cola.
                else if (statusParo === 'En Cola') {
                    tareasEnCola.push(tarea);
                }
            }
        }
        
        // MEJORA: La app del mecánico ordena su propia cola
        // Prioritiza 'detenida' sobre 'trabajando'
        tareasEnCola.sort((a, b) => {
            if (a.statusMaquina === 'detenida' && b.statusMaquina !== 'detenida') return -1;
            if (a.statusMaquina !== 'detenida' && b.statusMaquina === 'detenida') return 1;
            return 0; // Si son iguales, mantiene el orden de llegada
        });

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