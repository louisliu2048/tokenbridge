import React from 'react'
import { TransactionReceipt } from 'web3-eth'
import { useMessageConfirmations } from '../hooks/useMessageConfirmations'
import { MessageObject } from '../utils/web3'
import styled from 'styled-components'
import { CONFIRMATIONS_STATUS } from '../config/constants'
import { CONFIRMATIONS_STATUS_LABEL } from '../config/descriptions'
import { SimpleLoading } from './commons/Loading'
import { ValidatorsConfirmations } from './ValidatorsConfirmations'
import { getConfirmationsStatusDescription } from '../utils/networks'
import { useStateProvider } from '../state/StateProvider'

const StatusLabel = styled.label`
  font-weight: bold;
  font-size: 18px;
`

const StatusResultLabel = styled.label`
  font-size: 18px;
  padding-left: 10px;
`

const StyledConfirmationContainer = styled.div`
  background-color: var(--color-primary);
  padding: 10px;
  border-radius: 4px;
`

const StatusDescription = styled.div`
  padding-top: 10px;
`

export interface ConfirmationsContainerParams {
  message: MessageObject
  receipt: Maybe<TransactionReceipt>
  fromHome: boolean
}

export const ConfirmationsContainer = ({ message, receipt, fromHome }: ConfirmationsContainerParams) => {
  const {
    home: { name: homeName },
    foreign: { name: foreignName }
  } = useStateProvider()
  const { confirmations, status } = useMessageConfirmations({ message, receipt, fromHome })

  return (
    <div className="row is-center">
      <StyledConfirmationContainer className="col-9">
        <div className="row is-center">
          <StatusLabel>Status:</StatusLabel>
          <StatusResultLabel>
            {status !== CONFIRMATIONS_STATUS.UNDEFINED ? CONFIRMATIONS_STATUS_LABEL[status] : <SimpleLoading />}
          </StatusResultLabel>
        </div>
        <StatusDescription className="row is-center">
          <p className="col-10">
            {status !== CONFIRMATIONS_STATUS.UNDEFINED
              ? getConfirmationsStatusDescription(status, homeName, foreignName)
              : ''}
          </p>
        </StatusDescription>
        <ValidatorsConfirmations confirmations={confirmations} />
      </StyledConfirmationContainer>
    </div>
  )
}
