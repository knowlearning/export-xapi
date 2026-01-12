export function getFinalResultForNDigitOperation(problem) {
	const operand1 = parseInt(problem.operand1, 10);
	const operand2 = parseInt(problem.operand2, 10);
	switch (problem.operator) {
		case '+':
			return (
				operand1 +
				operand2 +
				(problem.additionalOperands?.reduce((acc, curr) => acc + parseInt(curr, 10), 0) || 0)
			);
		case '-':
			return (
				operand1 -
				operand2 -
				(problem.additionalOperands?.reduce((acc, curr) => acc - parseInt(curr, 10), 0) || 0)
			);
		case '*':
			return (
				operand1 *
				operand2 *
				(problem.additionalOperands?.reduce((acc, curr) => acc * parseInt(curr, 10), 1) || 1)
			);
	}
}


export function getCorrectAnswerText(problem) {
    let correctAnswerText = ''; 
    switch (problem.kind) {
        case 'multiple_choice':
            const correctOption = problem.options.find(opt => opt.isCorrect);
            if (correctOption) {
                if (correctOption.kind === 'text') {
                    correctAnswerText = correctOption.value;
                } else if (correctOption.kind === 'image') {
                    correctAnswerText = correctOption.altText;
                } else if (correctOption.kind === 'fraction') {
                    correctAnswerText = correctOption.wholeNumber ? `${correctOption.wholeNumber} ${correctOption.numerator}/${correctOption.denominator}` : `${correctOption.numerator}/${correctOption.denominator}`;
                }
            }
            break;
        case 'word_problem':
            console.log(problem.answerBlocks)
            const answerBlockValues = problem.answerBlocks.map(
                block => {
                    if (block.label && block.orientation === 'label_first') {
                        return `${block.label} ${block.value}`;
                    } else if (block.label && block.orientation === 'value_first') {
                        return `${block.value} ${block.label}`;
                    } else {
                        return block.value;
                    }
                }
            );
            correctAnswerText = answerBlockValues.join('; ');
            break;
        case 'n_digit_operation':
            correctAnswerText = getFinalResultForNDigitOperation(problem).toString();
            break;
        case 'fill_in_the_blank':
            correctAnswerText = Object.entries(problem.blanks).map(
                ([blankId, blankData]) => {
                    return `${blankId}: ${blankData}`;
                }
            ).join('; ');
            break;
        default:
            correctAnswerText = problem.correctAnswer || '';
            break;
    }
    return correctAnswerText;
}

export function getStudentAnswerText(runState, problem) {
    if (!runState || !problem) return '';

    const state = typeof runState === 'string' ? JSON.parse(runState) : runState;

    switch (problem.kind) {
        case 'multiple_choice':
            const selectedOptionId = state.selectedOptionId;
            const selectedOption = problem.options?.find(opt => opt.id === selectedOptionId);
            if (selectedOption) {
                if (selectedOption.kind === 'text') {
                    return selectedOption.value;
                } else if (selectedOption.kind === 'image') {
                    return selectedOption.altText || selectedOption.id;
                } else if (selectedOption.kind === 'fraction') {
                    return selectedOption.wholeNumber
                        ? `${selectedOption.wholeNumber} ${selectedOption.numerator}/${selectedOption.denominator}`
                        : `${selectedOption.numerator}/${selectedOption.denominator}`;
                }
            }
            break;

        case 'fill_in_the_blank':
            if (state.blankValues) {
                return Object.entries(state.blankValues)
                    .map(([blankId, value]) => `${blankId}: ${value}`)
                    .join('; ');
            }
            break;

        case 'word_problem':
            if (state.answerBlockValues) {
                return Object.values(state.answerBlockValues).join('; ');
            }
            break;

        case 'n_digit_operation':
            return state.finalResult;

        default:
            return JSON.stringify(state);
    }

    return typeof runState === 'string' ? runState : JSON.stringify(runState);
}