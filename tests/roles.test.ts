import { describe, it, expect } from 'vitest'
import { inferRoleFromJD } from '../src/roles.js'

describe('inferRoleFromJD', () => {
  it('returns the highest-scoring role when keywords match', () => {
    expect(inferRoleFromJD('要求熟悉 Go、gRPC、Kafka 和高并发系统')).toBe('go')
  })

  it('returns undefined when no role keyword matches', () => {
    expect(inferRoleFromJD('负责门店运营、会员活动策划和库存盘点')).toBeUndefined()
  })
})
