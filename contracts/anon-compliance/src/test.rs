#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Bytes};

fn hash(env: &Env, parts: &[BytesN<32>]) -> BytesN<32> {
    let mut bytes = Bytes::new(env);
    for part in parts {
        bytes.append(&part.clone().into());
    }
    env.crypto().sha256(&bytes).into()
}

fn bytes32(env: &Env, value: u8) -> BytesN<32> {
    BytesN::from_array(env, &[value; 32])
}

#[test]
fn accepts_valid_demo_proof_and_blocks_replay() {
    let env = Env::default();
    let contract_id = env.register(AnonComplianceContract, ());
    let client = AnonComplianceContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let policy_hash = bytes32(&env, 1);
    let verifier_hash = bytes32(&env, 2);

    env.mock_all_auths();
    client.initialize(&admin, &policy_hash, &verifier_hash);

    let subject_commitment = bytes32(&env, 3);
    let public_input_hash = bytes32(&env, 4);
    let nullifier = bytes32(&env, 5);
    let proof_hash = hash(
        &env,
        &[
            subject_commitment.clone(),
            public_input_hash.clone(),
            nullifier.clone(),
            policy_hash.clone(),
            verifier_hash.clone(),
        ],
    );

    let attestation = client.submit_compliance(
        &subject_commitment,
        &public_input_hash,
        &nullifier,
        &proof_hash,
    );

    assert_eq!(attestation.nullifier, nullifier);
    assert!(client.has_nullifier(&nullifier));

    let replay = client.try_submit_compliance(
        &subject_commitment,
        &public_input_hash,
        &nullifier,
        &proof_hash,
    );

    assert_eq!(replay, Err(Ok(Error::NullifierAlreadyUsed)));
}

#[test]
fn rejects_invalid_demo_proof() {
    let env = Env::default();
    let contract_id = env.register(AnonComplianceContract, ());
    let client = AnonComplianceContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let policy_hash = bytes32(&env, 1);
    let verifier_hash = bytes32(&env, 2);

    env.mock_all_auths();
    client.initialize(&admin, &policy_hash, &verifier_hash);

    let result = client.try_submit_compliance(
        &bytes32(&env, 3),
        &bytes32(&env, 4),
        &bytes32(&env, 5),
        &bytes32(&env, 9),
    );

    assert_eq!(result, Err(Ok(Error::InvalidProof)));
}
