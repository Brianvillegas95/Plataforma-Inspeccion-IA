const { google } = require('googleapis');

// --- Configuración de Autenticación ---
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

// --- Funciones de Verificación ---

/**
 * Verifica si ya existe un paro ABIERTO (En Cola, Asignado, En Proceso)
 * para la misma combinación de Area/Maquina/Estacion.
 */
async function checkForOpenDuplicate(sheets, area, maquina, estacion) {
  const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: produccionSheetId,
    range: 'Hoja 1!C2:N', // C(Area), D(Maquina), E(Estacion), N(StatusParo)
  });
  const jobs = response.data.values || [];
  
  const normArea = area ? area.trim() : '';
  const normMaquina = maquina ? maquina.trim() : '';
  const normEstacion = estacion ? estacion.trim() : '';

  for (const job of jobs) {
    const jobArea = job[0] ? job[0].trim() : '';
    const jobMaquina = job[1] ? job[1].trim() : '';
    const jobEstacion = job[2] ? job[2].trim() : '';
    const jobStatus = job[11] ? job[11].trim() : ''; // Col N (índice 11)

    if (jobArea === normArea && jobMaquina === normMaquina && jobEstacion === normEstacion &&
        (jobStatus === 'Asignado' || jobStatus === 'En Proceso' || jobStatus === 'En Cola')) {
      // ¡Encontrado!
      return true; 
    }
  }
  return false; // No se encontraron duplicados abiertos
}


// --- Funciones de Ayuda para Mecánicos ---

async function findMechanicByName(sheets, name) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const mecsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:E',
  });
  const mechanics = mecsResponse.data.values || [];
  for (let i = 0; i < mechanics.length; i++) {
    const dbName = mechanics[i][0] ? mechanics[i][0].trim() : '';
    const searchName = name ? name.trim() : '';
    if (dbName === searchName) {
      return {
        row: i + 2, name: mechanics[i][0], area: mechanics[i][1],
        availability: mechanics[i][2], 
        status: mechanics[i][3],
        TareaActual_RowID: mechanics[i][4]
      };
    }
  }
  return null;
}

/**
 * Busca si un mecánico ya tiene un trabajo "En Proceso" o "Asignado"
 */
async function findMechanicActiveJob(sheets, name) {
    const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
    const jobsResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: produccionSheetId,
        range: 'Hoja 1!M2:N',
    });
    const jobs = jobsResponse.data.values || [];
    for (let i = 0; i < jobs.length; i++) {
        const mecanicoAsignado = jobs[i][0];
        const statusParo = jobs[i][1];
        if (mecanicoAsignado === name && (statusParo === 'En Proceso' || statusParo === 'Asignado')) {
            return { row: i + 2, status: statusParo };
        }
    }
    return null; // No tiene trabajo activo
}

/**
 * Encuentra el primer mecánico "Libre" y "Disponible" en un área.
 * Esta es la nueva lógica de balanceo "Pull".
 */
async function findMechanicToAssign(sheets, area) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const mecsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:E',
  });
  const mechanics = mecsResponse.data.values || [];
  
  let freeMechanic = null;
  const normArea = area ? area.trim() : '';
  
  for (let i = 0; i < mechanics.length; i++) {
    const [name, assignedArea, availability, systemStatus] = mechanics[i];
    const normAssignedArea = assignedArea ? assignedArea.trim() : '';
    
    // Solo mecánicos del área y 'Disponibles'
    if (normAssignedArea === normArea && availability === 'Disponible') {
        const isFree = (!systemStatus || systemStatus === 'Libre');
        
        if (isFree) {
            freeMechanic = { row: i + 2, name: name, area: assignedArea, status: 'Libre' };
            break; // Encontramos uno libre, es suficiente.
        }
    }
  }
  // Solo devolvemos un mecánico si está 'Libre'.
  return freeMechanic || null;
}

/**
 * Actualiza el Status y TareaActual_RowID de un mecánico
 */
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

/**
 * Actualiza la Disponibilidad (Check-in) y sincroniza el Status
 */
async function updateMechanicAvailability(sheets, name, availability) {
  const mechanic = await findMechanicByName(sheets, name); 
  if (!mechanic) throw new Error(`Mecánico ${name} no encontrado en MECANICOS_DB.`);
  
  const activeJob = await findMechanicActiveJob(sheets, name);
  let newStatusSistema;

  if (availability === 'Disponible') {
      newStatusSistema = activeJob ? 'Ocupado' : 'Libre';
  } else {
      // Si es 'No Disponible', lo ponemos 'Ocupado' temporalmente.
      // La lógica de 'mecanico_check_out' lo limpiará a 'Libre'.
      newStatusSistema = 'Ocupado'; 
  }
  
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
 * Busca el próximo trabajo "En Espera" (priorizado) en un área.
 * Esta es la cola "Pull" compartida.
 */
async function findNextJobInSharedQueue(sheets, mechanicArea) {
  const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!C2:N', // C(Area), G(StatusMaquina), M(Mecanico), N(StatusParo)
  });
  const jobs = response.data.values || [];
  let highPriorityJob = null;
  let lowPriorityJob = null;
  const normMechanicArea = mechanicArea ? mechanicArea.trim() : '';

  for (let i = 0; i < jobs.length; i++) {
    const row = i + 2;
    const jobArea = jobs[i][0]; // Col C
    const jobStatusMaquina = jobs[i][4]; // Col G
    const mecanicoAsignado = jobs[i][10]; // Col M
    const jobStatusParo = jobs[i][11]; // Col N
    
    const normJobArea = jobArea ? jobArea.trim() : '';

    // Solo busca trabajos "En Espera" en la cola compartida
    if (normJobArea === normMechanicArea && mecanicoAsignado === 'En Espera' && jobStatusParo === 'En Cola') {
      
      // Prioridad: detenida
      if (jobStatusMaquina === 'detenida' && !highPriorityJob) {
        highPriorityJob = { row: row };
        break; // Encontramos el más antiguo/prioritario, terminamos
      }
      // Prioridad: trabajando (guardamos el primero que encontramos)
      if (jobStatusMaquina === 'trabajando' && !lowPriorityJob) {
        lowPriorityJob = { row: row };
      }
    }
  }
  // Devuelve el de alta prioridad, o si no, el de baja.
  return highPriorityJob || lowPriorityJob;
}

/**
 * Asigna UN trabajo (el jobRow) a UN mecánico.
 * Actualiza MANTENIMIENTO y MECANICOS_DB.
 */
async function reAssignPendingJob(sheets, mechanic, jobRow) {
  console.log(`RE-ASIGNACIÓN dinámica (Pull): ${mechanic.name} -> Fila ${jobRow}`);
  
  // 1. Poner al mecánico 'Ocupado' con el nuevo RowID
  await updateMechanicStatus(sheets, mechanic.row, 'Ocupado', jobRow);
  
  // 2. Asignar el trabajo al mecánico
  const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!M${jobRow}:N${jobRow}`, // Col M y N
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[mechanic.name, 'Asignado']], // Poner nombre y status 'Asignado'
    },
  });
}

/**
 * Función clave "Pull": Libera a un mecánico Y le hace "jalar" 1 nuevo trabajo.
 * Se usa al 'cerrar' un paro y al hacer 'check_in'.
 */
async function findAndAssignNextJob(sheets, mechanicName) {
  if (!mechanicName || mechanicName === 'En Espera') return;
  
  const mechanic = await findMechanicByName(sheets, mechanicName.trim()); 
  if (!mechanic) {
      console.log(`Mecánico ${mechanicName} no encontrado en DB.`);
      return;
  }
  
  // 1. Busca el próximo trabajo "En Espera" en la cola del área
  const nextJob = await findNextJobInSharedQueue(sheets, mechanic.area);
  
  if (nextJob) {
      // 2a. ¡Hay trabajo! Se lo asigna.
      console.log(`Mecánico ${mechanicName} está "Libre", asignando nuevo trabajo (Fila ${nextJob.row}).`);
      // Esta función lo pone 'Ocupado' y le da el RowID
      await reAssignPendingJob(sheets, mechanic, nextJob.row);
  } else {
      // 2b. No hay cola. Se asegura que esté "Libre" y sin RowID
      console.log(`Mecánico ${mechanicName} libre. No hay trabajos en cola "En Espera".`);
      await updateMechanicStatus(sheets, mechanic.row, 'Libre', '');
  }
}

/**
 * Libera TODOS los trabajos de un mecánico (al hacer logout)
 * y los devuelve a la cola de "En Espera".
 */
async function releaseAllJobs(sheets, mechanicName) {
    const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
    
    // 1. Encontrar todos los trabajos asignados a este mecánico
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId,
        range: 'Hoja 1!M2:N', // Col M (Mecanico), Col N (StatusParo)
    });
    const jobs = response.data.values || [];
    const jobsToRelease = [];

    for (let i = 0; i < jobs.length; i++) {
        const row = i + 2;
        const mecanicoAsignado = jobs[i][0];
        const statusParo = jobs[i][1];
        
        // Si el trabajo es de este mecánico y está activo...
        if (mecanicoAsignado === mechanicName && 
            (statusParo === 'Asignado' || statusParo === 'En Proceso' || statusParo === 'En Cola')) {
            jobsToRelease.push(row);
        }
    }

    if (jobsToRelease.length === 0) {
        console.log(`Mecánico ${mechanicName} no tiene trabajos activos que liberar.`);
        return;
    }

    // 2. Crear un batchUpdate para ponerlos "En Espera" y "En Cola"
    const dataForBatchUpdate = jobsToRelease.map(row => ({
        range: `Hoja 1!M${row}:N${row}`,
        values: [['En Espera', 'En Cola']], // Devolver a la cola compartida
    }));
    
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: spreadsheetId,
        resource: {
            valueInputOption: 'USER_ENTERED',
            data: dataForBatchUpdate
        }
    });
    console.log(`Liberados ${jobsToRelease.length} trabajos de ${mechanicName} a la cola "En Espera".`);
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
      
      // --- Acción 'abrir' ---
      case 'abrir': {
        if (!data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "data".' }) };
        const [fechaApertura, areaDelParo, maquinaDelParo, estacionDelParo, operador, statusMaquina, workOrder] = data;

        // 1. Verificación de Duplicados
        const isDuplicate = await checkForOpenDuplicate(sheets, areaDelParo, maquinaDelParo, estacionDelParo);
        if (isDuplicate) {
            console.log(`BLOQUEADO: Intento de duplicar paro para ${maquinaDelParo}`);
            return { 
                statusCode: 409, 
                body: JSON.stringify({ error: 'Ya existe un reporte de paro activo para esta máquina.' }) 
            };
        }

        const now = new Date();
        const folio = `MAN-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        
        // 2. Lógica "Pull": Solo busca mecánicos 'Libres'
        const mechanicToAssign = await findMechanicToAssign(sheets, areaDelParo);
        let statusParo;
        let mecanicoAsignado;
        
        if (mechanicToAssign) {
            // Flujo A: Encontramos un mecánico "Libre"
            statusParo = 'Asignado';
            mecanicoAsignado = mechanicToAssign.name;
            console.log(`Asignando a ${mechanicToAssign.name} (está Libre)`);
        } else {
            // Flujo B: NO hay mecánicos "Libres"
            console.log(`No hay mecánicos LIBRES para ${areaDelParo}. Poniendo "En Espera".`);
            statusParo = 'En Cola';
            mecanicoAsignado = 'En Espera';
        }
        
        // 3. Escribir el reporte
        const dataToWrite = [ folio, ...data, '', '', '', '', mecanicoAsignado, statusParo ];
        const response = await sheets.spreadsheets.values.append({
          spreadsheetId: produccionSheetId,
          range: 'Hoja 1!A1',
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [dataToWrite] },
        });

        const newRow = getRowFromRange(response.data.updates.updatedRange);
        
        // 4. Actualizar al mecánico (Solo en Flujo A)
        if (mechanicToAssign) {
            await updateMechanicStatus(sheets, mechanicToAssign.row, 'Ocupado', newRow);
        }
        
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            row: newRow, 
            status: statusParo,
            mecanico: mecanicoAsignado,
            folio: folio
          }),
        };
      }
      
      // --- Acción 'cerrar' ---
      case 'cerrar': {
        if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "data".' }) };
        const nombreMecanicoFormulario = data[1]; 
        
        // 1. Leer quién estaba asignado
        const getResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: produccionSheetId,
            range: `Hoja 1!M${row}`,
        });
        const mecanicoAsignadoOriginal = getResponse.data.values ? getResponse.data.values[0][0] : null;
        
        // 2. Marcar el trabajo como "Cerrado"
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: produccionSheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
              { range: `Hoja 1!I${row}:J${row}`, values: [[ data[0], nombreMecanicoFormulario ]] }, 
              { range: `Hoja 1!L${row}`, values: [[ data[2] ]] }, 
              { range: `Hoja 1!N${row}`, values: [['Cerrado']] } 
            ]
          }
        });

        // 3. Liberar al mecánico Y que "jale" el próximo trabajo "En Espera"
        if (mecanicoAsignadoOriginal && mecanicoAsignadoOriginal !== 'En Espera') {
            console.log(`Mecánico ${mecanicoAsignadoOriginal} terminó trabajo. Buscando próximo...`);
            await findAndAssignNextJob(sheets, mecanicoAsignadoOriginal);
        } else {
             console.log(`Fila ${row} cerrada sin un mecánico original que liberar.`);
        }
        
        return { statusCode: 200, body: JSON.stringify({ message: 'Paro finalizado.' }) };
      }
      
      // --- Acción 'mecanico_check_in' ---
      case 'mecanico_check_in': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        
        // 1. Sincroniza estado y lo pone 'Disponible'
        const mechanic = await updateMechanicAvailability(sheets, name, 'Disponible');
        
        // 2. Si está 'Libre' (sin trabajo activo)...
        if (mechanic.status === 'Libre') {
            console.log(`Mecánico ${name} está libre, "jalando" 1 trabajo de la cola...`);
            // 3. "Jala" (pull) el trabajo más urgente de la cola "En Espera"
            await findAndAssignNextJob(sheets, mechanic.name);
        } else {
            console.log(`Mecánico ${name} hizo check-in pero ya está ${mechanic.status}.`);
        }
        return { statusCode: 200, body: JSON.stringify({ message: `Mecánico ${name} check-in.` }) };
      }

      // --- Acción 'llegada' ---
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

      // --- Acción 'escalar_paro' ---
      case 'escalar_paro': {
        if (!row) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row".' }) };
        console.log(`Escalando Fila ${row} a "detenida"`);
        await sheets.spreadsheets.values.update({
          spreadsheetId: produccionSheetId,
          range: `Hoja 1!G${row}`, // Col G (Status maquina)
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: [['detenida']]
          },
        });
        return { statusCode: 200, body: JSON.stringify({ message: 'Paro escalado a DETENIDA.' }) };
      }

      // --- Acción 'check_status' ---
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
      
      // --- Acción 'mecanico_check_out' ---
      case 'mecanico_check_out': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        
        const mechanic = await findMechanicByName(sheets, name);
        if (mechanic) {
            // 1. ¡CLAVE! Liberar todos sus trabajos y ponerlos "En Espera"
            await releaseAllJobs(sheets, name);
            
            // 2. Actualizar su estado a 'No Disponible', 'Libre' y limpiar su RowID
            await sheets.spreadsheets.values.update({
                spreadsheetId: process.env.MECANICOS_SHEET_ID,
                range: `Hoja 1!C${mechanic.row}:E${mechanic.row}`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [['No Disponible', 'Libre', '']]
                },
            });
        }
        return { statusCode: 200, body: JSON.stringify({ message: `Mecánico ${name} check-out.` }) };
      }
      
      // --- Acción 'get_mecanico_tareas' ---
      case 'get_mecanico_tareas': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        
        // 1. Obtener el área del mecánico
        const mechanic = await findMechanicByName(sheets, name);
        if (!mechanic) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Mecánico no encontrado.' }) };
        }
        const normMechanicArea = mechanic.area ? mechanic.area.trim() : '';

        let tareaActual = null;
        const tareasEnCola = [];
        
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: produccionSheetId,
          range: 'Hoja 1!A2:N', 
        });
        const jobs = response.data.values || [];
        
        for (let i = 0; i < jobs.length; i++) {
            const row = i + 2; 
            const [folio, , area, maquina, estacion, , statusMaquina, , , , , , mecanicoAsignado, statusParo] = jobs[i];
            const jobArea = area ? area.trim() : '';
            
            const tarea = { row, folio, area, maquina, estacion, statusParo, statusMaquina };
            
            // 2. Buscar su tarea personal (Actual o en Cola personal)
            if (mecanicoAsignado === name) {
                if (statusParo === 'En Proceso') {
                    tareaActual = tarea;
                }
                else if (statusParo === 'Asignado') {
                    if (!tareaActual) {
                         tareaActual = tarea;
                    } else {
                         tareasEnCola.push(tarea); // Cola personal
                    }
                }
                else if (statusParo === 'En Cola') {
                    tareasEnCola.push(tarea); // Cola personal
                }
            }
            // 3. ¡CLAVE! Buscar tareas "En Espera" del ÁREA
            else if (jobArea === normMechanicArea && mecanicoAsignado === 'En Espera' && statusParo === 'En Cola') {
                tareasEnCola.push(tarea);
Y
            }
        }

        // 4. Ordenar la lista de cola combinada (personal + compartida)
        tareasEnCola.sort((a, b) => {
            // Prioridad 1: Status (detenida va primero)
            if (a.statusMaquina === 'detenida' && b.statusMaquina !== 'detenida') return -1;
            if (a.statusMaquina !== 'detenida' && b.statusMaquina === 'detenida') return 1;
            // Prioridad 2: Antigüedad (fila más baja va primero)
            return a.row - b.row;
        });
        
        return { statusCode: 200, body: JSON.stringify({ tareaActual, tareasEnCola }) };
      }
      
      // --- Acción 'get_mecanicos_activos' ---
      case 'get_mecanicos_activos': {
          const spreadsheetId = process.env.MECANICOS_SHEET_ID;
          if (!spreadsheetId) {
            throw new Error('MECANICOS_SHEET_ID no está configurado.');
          }
          const mecsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: 'Hoja 1!A2:C',
          });
          const mechanics = mecsResponse.data.values || [];
          const activos = mechanics
            .filter(mec => mec[0] && mec[2] === 'Disponible')
            .map(mec => mec[0]);
          return { statusCode: 200, body: JSON.stringify({ mecanicos: activos.sort() }) };
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