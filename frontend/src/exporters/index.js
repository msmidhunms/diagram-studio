// Export formats generated from the system model, without calling the LLM.
import { toC4 } from './c4'
import { toD2 } from './d2'
import { toDrawio } from './drawio'
import { toExcalidraw } from './excalidraw'
import { toPlantUml } from './plantuml'

// build(model, title) may be async; suffix is added to the file name
export const MODEL_EXPORTS = [
  { id: 'drawio', label: 'Draw.io (.drawio)', ext: 'drawio', mime: 'application/xml', build: toDrawio },
  { id: 'excalidraw', label: 'Excalidraw (.excalidraw)', ext: 'excalidraw', mime: 'application/json', build: toExcalidraw },
  { id: 'plantuml', label: 'PlantUML (.puml)', ext: 'puml', mime: 'text/plain', build: toPlantUml },
  { id: 'c4', label: 'C4 container – PlantUML (.puml)', ext: 'puml', suffix: 'c4', mime: 'text/plain', build: toC4 },
  { id: 'd2', label: 'D2 (.d2)', ext: 'd2', mime: 'text/plain', build: toD2 },
  {
    id: 'json', label: 'System model (.json)', ext: 'json', mime: 'application/json',
    build: (model) => JSON.stringify(model, null, 2) + '\n',
  },
]
