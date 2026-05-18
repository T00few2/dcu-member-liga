"""
Tests for the results processing error hierarchy.

Run with:  python -m pytest backend/tests/test_error_hierarchy.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest

from services.results.errors import (
    ResultsProcessingError,
    FatalResultsError,
    RecoverableResultsError,
    RaceNotFoundError,
    ConfigurationError,
    EventInfoFetchError,
    FinishSegmentResolutionError,
    StartTimeParseError,
    CategoryAssignmentError,
    DualRecordingWorkflowError,
)


class TestResultsProcessingError:
    def test_message_stored(self):
        err = ResultsProcessingError('something went wrong')
        assert err.message == 'something went wrong'
        assert str(err) == 'something went wrong'

    def test_context_stored(self):
        err = ResultsProcessingError('oops', context={'race_id': 'r1'})
        assert err.context == {'race_id': 'r1'}

    def test_str_includes_context(self):
        err = ResultsProcessingError('oops', context={'key': 'val'})
        s = str(err)
        assert 'oops' in s
        assert 'key' in s
        assert 'val' in s

    def test_empty_context_no_parentheses(self):
        err = ResultsProcessingError('plain')
        assert str(err) == 'plain'

    def test_is_exception(self):
        with pytest.raises(ResultsProcessingError):
            raise ResultsProcessingError('test')


class TestFatalResultsError:
    def test_is_results_processing_error(self):
        err = FatalResultsError('fatal')
        assert isinstance(err, ResultsProcessingError)

    def test_is_not_recoverable(self):
        err = FatalResultsError('fatal')
        assert not isinstance(err, RecoverableResultsError)

    def test_can_be_raised_and_caught_as_base(self):
        with pytest.raises(ResultsProcessingError):
            raise FatalResultsError('fatal')


class TestRecoverableResultsError:
    def test_is_results_processing_error(self):
        err = RecoverableResultsError('recoverable')
        assert isinstance(err, ResultsProcessingError)

    def test_is_not_fatal(self):
        err = RecoverableResultsError('recoverable')
        assert not isinstance(err, FatalResultsError)


class TestConcreteErrors:
    @pytest.mark.parametrize('cls,expected_base', [
        (RaceNotFoundError, FatalResultsError),
        (ConfigurationError, FatalResultsError),
        (CategoryAssignmentError, FatalResultsError),
    ])
    def test_fatal_subclasses(self, cls, expected_base):
        err = cls('msg')
        assert isinstance(err, expected_base)
        assert isinstance(err, ResultsProcessingError)

    @pytest.mark.parametrize('cls,expected_base', [
        (EventInfoFetchError, RecoverableResultsError),
        (FinishSegmentResolutionError, RecoverableResultsError),
        (StartTimeParseError, RecoverableResultsError),
        (DualRecordingWorkflowError, RecoverableResultsError),
    ])
    def test_recoverable_subclasses(self, cls, expected_base):
        err = cls('msg')
        assert isinstance(err, expected_base)
        assert isinstance(err, ResultsProcessingError)

    def test_category_assignment_error_not_recoverable(self):
        err = CategoryAssignmentError('assignment failed')
        assert not isinstance(err, RecoverableResultsError)

    def test_dual_recording_workflow_error_not_fatal(self):
        err = DualRecordingWorkflowError('dr failed')
        assert not isinstance(err, FatalResultsError)

    def test_context_propagation(self):
        err = CategoryAssignmentError('assign', context={'zwift_id': '42', 'cat': 'A'})
        assert err.context['zwift_id'] == '42'
        s = str(err)
        assert 'assign' in s
        assert 'zwift_id' in s
