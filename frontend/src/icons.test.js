import { describe, expect, it } from 'vitest'
import catalogue from '../../shared/cloud_icons.json'
import model from './__fixtures__/multicloud.json'
import { layoutModel, modelToSvg } from './autolayout'
import { toD2 } from './exporters/d2'
import { toDrawio } from './exporters/drawio'
import { toExcalidraw } from './exporters/excalidraw'
import { toPlantUml } from './exporters/plantuml'
import { ICON_SLOT, iconInfo, loadIcons } from './icons'

const FAKE = 'data:image/svg+xml;base64,PHN2Zy8+'
const stub = () => Promise.resolve(FAKE) // no network in tests

describe('catalogue', () => {
  it('every icon can be drawn somewhere and uses https artwork', () => {
    for (const [key, v] of Object.entries(catalogue.icons)) {
      expect(key, key).toMatch(/^(aws|azure|gcp):[a-z0-9_]+$/)
      expect(v.img || v.drawio || v.puml, key).toBeTruthy()
      if (v.img) expect(v.img, key).toMatch(/^https:\/\//)
      if (key.startsWith('aws:')) expect(v.drawio_color, key).toMatch(/^#[0-9A-F]{6}$/)
    }
  })
  it('resolves provider details and ignores unknown keys', () => {
    expect(iconInfo('azure:cosmos_db')).toMatchObject({ provider: 'azure', providerName: 'Azure', label: 'Azure Cosmos DB' })
    expect(iconInfo('aws:nope')).toBeNull()
    expect(iconInfo(null)).toBeNull()
  })
  it('loads each distinct icon once, and only icons that have artwork', async () => {
    const asked = []
    const icons = await loadIcons(model, (k) => { asked.push(k); return stub() })
    expect(icons.size).toBe(new Set(model.nodes.map((n) => n.icon).filter(Boolean)).size)
    expect(asked).toHaveLength(icons.size - 2) // Bedrock and BigQuery have no artwork
    expect(asked).not.toContain('gcp:bigquery')
    expect(icons.get('gcp:bigquery')).toBeNull()
  })
})

describe('auto-layout', () => {
  it('reserves room for the icon and embeds artwork', async () => {
    const plain = await layoutModel({ ...model, nodes: model.nodes.map((n) => ({ ...n, icon: null })) })
    const withIcons = await layoutModel(model)
    expect(withIcons.shapes.get('n_fn').width - plain.shapes.get('n_fn').width).toBe(ICON_SLOT)
    const svg = await modelToSvg(model, { loadIcon: stub })
    expect(svg.match(/<image /g)).toHaveLength(9) // 11 icons, 2 without artwork (Bedrock, BigQuery)
    expect(svg).toContain('xmlns:xlink=')
  })
  it('falls back to a provider badge when artwork is unavailable', async () => {
    const svg = await modelToSvg(model, { loadIcon: () => Promise.resolve(null) })
    expect(svg).not.toContain('<image ')
    for (const p of ['AWS', 'Azure', 'GCP']) expect(svg).toContain(`fill="#ffffff">${p}</text>`)
  })
})

describe('exports', () => {
  it('draw.io uses its own AWS stencils and Azure images', async () => {
    const out = await toDrawio(model)
    expect(out).toContain('resIcon=mxgraph.aws4.lambda;')
    expect(out).toContain('image=img/lib/azure2/databases/Azure_Cosmos_DB.svg;')
    expect(out).toMatch(/<mxCell id="n_fn_icon" [^>]*parent="n_fn"/)
    expect(out).not.toContain('n_bq_icon') // BigQuery: no draw.io artwork, label only
  })
  it('D2 references icon URLs', () => {
    expect(toD2(model)).toContain('icon: "https://icons.terrastruct.com/aws%2FCompute%2FAWS-Lambda.svg"')
  })
  it('PlantUML includes the cloud libraries and uses their macros', () => {
    const out = toPlantUml(model)
    expect(out.indexOf('!include <awslib/AWSCommon>')).toBeLessThan(out.indexOf('!include <awslib/Compute/Lambda>'))
    expect(out).toContain('Lambda(n_fn, "Order handler", "Python 3.13")')
    expect(out).toContain('SimpleQueueService(n_queue, "Order queue", "Amazon SQS")')
    expect(out).toContain('BigQuery(n_bq, "Warehouse", "BigQuery")')
    expect(out).toContain('cloud "Product Q&A" as n_llm') // Bedrock: not in PlantUML's library
  })
  it('Excalidraw embeds icon files referenced by image elements', async () => {
    const scene = JSON.parse(await toExcalidraw(model, '', { loadIcon: stub }))
    const images = scene.elements.filter((e) => e.type === 'image')
    expect(images).toHaveLength(9)
    for (const img of images) expect(scene.files[img.fileId].dataURL).toBe(FAKE)
  })
})
