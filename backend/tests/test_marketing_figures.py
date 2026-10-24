"""Figures quoted on the public website that are derived from backend configuration
(src/features/marketing2/figures.ts). A change to the training options must update the site."""

from runners import cnn_architectures as ca
from runners import trainer_options as to


def test_discrete_training_setups_match_the_website():
    scratch_only = sum(1 for a in ca.ARCHITECTURES.values() if not a.supports_transfer)
    with_transfer = sum(len(to.TRANSFER_MODES) for a in ca.ARCHITECTURES.values() if a.supports_transfer)
    allowed_augmentations = sum(1 for a in to.AUGMENTATIONS.values() if a["allowed"])
    factors = [
        scratch_only + with_transfer,
        len(to.OPTIMIZERS),
        len(to.SCHEDULES),
        len(to.SELECTION_METRICS),
        len(to.CLASS_WEIGHTING),
        2 ** allowed_augmentations,
    ]
    assert factors == [9, 3, 4, 5, 2, 4]
    assert len(ca.ARCHITECTURES) == 7
    total = 1
    for n in factors:
        total *= n
    assert total == 4_320
