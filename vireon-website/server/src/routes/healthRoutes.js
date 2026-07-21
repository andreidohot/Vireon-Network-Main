import { Router } from 'express'

const router = Router()

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'vireon-network-server',
    mode: 'cms_and_mainnet_candidate_rpc_adapter',
  })
})

export default router
