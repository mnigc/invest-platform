import * as echarts from 'echarts/core'
import { LineChart, BarChart, ScatterChart, HeatmapChart } from 'echarts/charts'
import {
  GridComponent, TooltipComponent, LegendComponent,
  VisualMapComponent, DataZoomComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart, BarChart, ScatterChart, HeatmapChart,
  GridComponent, TooltipComponent, LegendComponent,
  VisualMapComponent, DataZoomComponent,
  CanvasRenderer,
])

export default echarts
